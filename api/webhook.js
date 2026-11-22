import Stripe from 'stripe';
import { PLANS, planFromPriceId, intervalFromPriceId, topupFromPriceId } from '../lib/plans.js';
import { admin } from '../lib/server.js';

export const config = { api: { bodyParser: false } }; // Stripe signs the raw body

async function rawBody(req) { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c); }
const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);

// Stripe -> us. The ONLY place paid access and purchased credits are granted. The signature is verified first.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try { event = stripe.webhooks.constructEvent(await rawBody(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).send('Bad signature'); }

  const db = admin();
  const { error: dup } = await db.from('stripe_events').insert({ id: event.id });
  if (dup) return res.status(200).send('Already processed'); // safe to receive twice

  try {
    const sync = async (sub) => {
      const userId = sub.metadata?.user_id;
      if (!userId) return;
      const item = sub.items?.data?.[0];
      const priceId = item?.price?.id;
      const active = ['active', 'trialing'].includes(sub.status);
      const newPlan = active ? planFromPriceId(priceId) || 'free' : 'free';
      const { data: before } = await db.from('profiles').select('plan, subscription_status').eq('id', userId).single();
      await db.from('profiles').update({
        plan: newPlan, billing_interval: active ? intervalFromPriceId(priceId) : null,
        stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, subscription_status: sub.status,
        current_period_start: iso(sub.current_period_start ?? item?.current_period_start),
        current_period_end: iso(sub.current_period_end ?? item?.current_period_end),
      }).eq('id', userId);
      // Upgrading mid-period: give the extra credits right away.
      if (active && before?.plan && before.plan !== 'free' && before.subscription_status === 'active' && before.plan !== newPlan) {
        const diff = (PLANS[newPlan]?.credits || 0) - (PLANS[before.plan]?.credits || 0);
        if (diff > 0) await db.rpc('add_credits', { p_user: userId, p_amount: diff, p_reason: 'upgrade', p_ref: sub.id });
      }
    };

    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) await sync(event.data.object);

    if (event.type === 'invoice.paid') {
      const inv = event.data.object;
      if (['subscription_cycle', 'subscription_create'].includes(inv.billing_reason)) {
        const subId = inv.subscription || inv.parent?.subscription_details?.subscription;
        let priceId = null, userId = null;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(typeof subId === 'string' ? subId : subId.id);
          priceId = sub.items?.data?.[0]?.price?.id; userId = sub.metadata?.user_id || null;
        }
        const key = planFromPriceId(priceId);
        if (!userId) { const { data: row } = await db.from('profiles').select('id').eq('stripe_customer_id', inv.customer).maybeSingle(); userId = row?.id || null; }
        if (key && userId) {
          await db.from('profiles').update({ generations_used: 0 }).eq('id', userId);
          const { error } = await db.rpc('refill_credits', { p_user: userId, p_amount: PLANS[key].credits, p_reason: 'monthly_refill', p_ref: inv.id });
          if (error) throw new Error('refill failed: ' + error.message);
        }
      }
    }

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      if (s.mode === 'payment' && s.metadata?.kind === 'topup' && s.payment_status === 'paid') {
        const userId = s.metadata.user_id || s.client_reference_id;
        const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 5 });
        const t = topupFromPriceId(items.data?.[0]?.price?.id);
        if (t && userId) {
          const { error } = await db.rpc('add_credits', { p_user: userId, p_amount: t.credits, p_reason: 'topup', p_ref: s.id });
          if (error) throw new Error('topup failed: ' + error.message);
        }
      }
    }
  } catch (e) {
    console.error('[webhook]', event.type, e.message);
    await db.from('stripe_events').delete().eq('id', event.id); // let Stripe retry
    return res.status(500).send('Retry');
  }
  res.status(200).send('ok');
}
