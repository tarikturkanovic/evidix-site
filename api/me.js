import { PLANS } from '../lib/plans.js';
import { admin, authUser, send } from '../lib/server.js';

// Current user's plan and remaining generations, read from the database (never trusted from the browser).
export default async function handler(req, res) {
  const db = admin();
  const user = await authUser(req, db);
  if (!user) return send(res, 401, { error: 'Please sign in.' });
  const { data: p } = await db.from('profiles').select('plan, subscription_status, generations_used, current_period_end, stripe_customer_id').eq('id', user.id).single();
  const key = p?.plan || 'free';
  const plan = PLANS[key];
  send(res, 200, {
    email: user.email, plan: key, planName: plan.name, status: p?.subscription_status || 'none',
    used: p?.generations_used || 0, limit: plan.monthlyGenerations, detail: plan.detail,
    renews: p?.current_period_end || null, hasBilling: !!p?.stripe_customer_id,
  });
}
