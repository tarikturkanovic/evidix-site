import Stripe from 'stripe';
import { PLANS, TOPUPS } from '../lib/plans.js';
import { admin, authUser, send } from '../lib/server.js';

// POST /api/checkout { plan, interval: 'month'|'year' } -> subscription Checkout
// POST /api/checkout { topup: 't600' }                  -> one-time credit pack (active subscribers only)
// Access and credits are granted only by the webhook.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY) return send(res, 503, { error: 'Payments are not configured yet.' });
  const db = admin();
  const user = await authUser(req, db);
  if (!user) return send(res, 401, { error: 'Please sign in.' });
  const { data: p } = await db.from('profiles').select('stripe_customer_id, subscription_status').eq('id', user.id).single();
  const active = ['active', 'trialing'].includes(p?.subscription_status);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const site = process.env.SITE_URL || 'https://evidixai.com';
  const customer = p?.stripe_customer_id ? { customer: p.stripe_customer_id } : { customer_email: user.email };

  try {
    if (req.body?.topup) {
      const t = TOPUPS[req.body.topup];
      if (!t?.stripePriceId) return send(res, 400, { error: 'That credit pack is not available.' });
      if (!active) return send(res, 403, { error: 'Credit packs are for subscribers. Choose a plan first.' });
      const session = await stripe.checkout.sessions.create({
        mode: 'payment', line_items: [{ price: t.stripePriceId, quantity: 1 }], ...customer,
        client_reference_id: user.id, metadata: { user_id: user.id, kind: 'topup' },
        success_url: `${site}/app/#/subscription?topup=success`, cancel_url: `${site}/app/#/subscription`,
      });
      return send(res, 200, { url: session.url });
    }
    const interval = req.body?.interval === 'year' ? 'year' : 'month';
    const priceId = PLANS[req.body?.plan]?.prices?.[interval];
    if (!priceId) return send(res, 400, { error: 'That plan is not available.' });
    if (active) return send(res, 409, { error: 'You already have a subscription. Use Manage billing to change it.' });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', line_items: [{ price: priceId, quantity: 1 }], ...customer,
      client_reference_id: user.id, subscription_data: { metadata: { user_id: user.id } },
      success_url: `${site}/app/#/subscription?checkout=success`, cancel_url: `${site}/app/#/subscription`,
    });
    send(res, 200, { url: session.url });
  } catch (e) {
    console.error('[checkout]', e.code, e.message);
    send(res, 502, { error: 'Could not start checkout. Please try again.' });
  }
}
