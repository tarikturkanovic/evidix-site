import Stripe from 'stripe';
import { PLANS } from '../lib/plans.js';
import { admin, authUser, send } from '../lib/server.js';

// POST /api/checkout { plan } -> { url } for Stripe Checkout. Paid access is granted only by the webhook.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY) return send(res, 503, { error: 'Payments are not configured yet.' });
  const db = admin();
  const user = await authUser(req, db);
  if (!user) return send(res, 401, { error: 'Please sign in.' });
  const priceId = PLANS[req.body?.plan]?.stripePriceId;
  if (!priceId) return send(res, 400, { error: 'That plan is not available.' });

  const { data: p } = await db.from('profiles').select('stripe_customer_id, subscription_status').eq('id', user.id).single();
  if (['active', 'trialing'].includes(p?.subscription_status)) return send(res, 409, { error: 'You already have a subscription. Use Manage billing to change it.' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const site = process.env.SITE_URL || 'https://evidixai.com';
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    ...(p?.stripe_customer_id ? { customer: p.stripe_customer_id } : { customer_email: user.email }),
    client_reference_id: user.id,
    subscription_data: { metadata: { user_id: user.id } },
    success_url: `${site}/app/#/subscription?checkout=success`,
    cancel_url: `${site}/app/#/subscription`,
  });
  send(res, 200, { url: session.url });
}
