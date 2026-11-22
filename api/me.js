import { PLANS, COSTS } from '../lib/plans.js';
import { maybeRefill } from '../lib/credits.js';
import { admin, authUser, send } from '../lib/server.js';

// Current user's plan and credit balance, read from the database (never trusted from the browser).
export default async function handler(req, res) {
  const db = admin();
  const user = await authUser(req, db);
  if (!user) return send(res, 401, { error: 'Please sign in.' });
  const { data: p0 } = await db.from('profiles').select('plan, subscription_status, billing_interval, credits, credits_period_start, current_period_end, stripe_customer_id').eq('id', user.id).single();
  const p = await maybeRefill(db, user.id, p0);
  const key = p?.plan || 'free';
  const plan = PLANS[key] || PLANS.free;
  let refreshes = p?.current_period_end || null;
  if (p?.billing_interval === 'year' && p.credits_period_start) { const d = new Date(p.credits_period_start); d.setMonth(d.getMonth() + 1); refreshes = d.toISOString(); }
  send(res, 200, {
    email: user.email, plan: key, planName: plan.name, status: p?.subscription_status || 'none',
    credits: p?.credits ?? 0, creditsMax: plan.credits, interval: p?.billing_interval || null,
    detail: plan.detail, renews: p?.current_period_end || null, refreshes, costs: COSTS, hasBilling: !!p?.stripe_customer_id,
  });
}
