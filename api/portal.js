import Stripe from 'stripe';
import { admin, authUser, send } from '../lib/server.js';

// POST /api/portal -> { url } to Stripe's customer portal (manage or cancel the subscription).
export default async function handler(req, res) {
  if (!process.env.STRIPE_SECRET_KEY) return send(res, 503, { error: 'Payments are not configured yet.' });
  const db = admin();
  const user = await authUser(req, db);
  if (!user) return send(res, 401, { error: 'Please sign in.' });
  const { data: p } = await db.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
  if (!p?.stripe_customer_id) return send(res, 400, { error: 'No billing account yet.' });
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const site = process.env.SITE_URL || 'https://evidixai.com';
    const s = await stripe.billingPortal.sessions.create({ customer: p.stripe_customer_id, return_url: `${site}/app/#/subscription` });
    return send(res, 200, { url: s.url });
  } catch (e) {
    console.error('[portal failed]', e && e.code, e && e.type, e && e.message);
    return send(res, 502, { error: 'Could not open the billing portal (' + ((e && (e.code || e.type)) || 'error') + '). ' + String((e && e.message) || '').slice(0, 140) });
  }
}
