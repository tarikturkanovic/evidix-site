import Stripe from 'stripe';
import { planFromPriceId } from '../lib/plans.js';
import { admin } from '../lib/server.js';

export const config = { api: { bodyParser: false } }; // Stripe signs the raw body

async function rawBody(req) { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c); }
const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);

// Stripe -> us. The ONLY place paid access is granted or removed. The signature is verified first.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try { event = stripe.webhooks.constructEvent(await rawBody(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).send('Bad signature'); }

  const db = admin();
  const { error: dup } = await db.from('stripe_events').insert({ id: event.id });
  if (dup) return res.status(200).send('Already processed'); // safe to receive twice

  const sync = async (sub) => {
    const userId = sub.metadata?.user_id;
    if (!userId) return;
    const item = sub.items?.data?.[0];
    const active = ['active', 'trialing'].includes(sub.status);
    await db.from('profiles').update({
      plan: active ? planFromPriceId(item?.price?.id) || 'free' : 'free',
      stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, subscription_status: sub.status,
      current_period_start: iso(sub.current_period_start ?? item?.current_period_start),
      current_period_end: iso(sub.current_period_end ?? item?.current_period_end),
    }).eq('id', userId);
  };

  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) await sync(event.data.object);
  if (event.type === 'invoice.paid') {
    const inv = event.data.object;
    if (['subscription_cycle', 'subscription_create'].includes(inv.billing_reason)) await db.from('profiles').update({ generations_used: 0 }).eq('stripe_customer_id', inv.customer);
  }
  res.status(200).send('ok');
}
