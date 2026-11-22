import { PLANS } from './plans.js';

// Yearly subscribers are billed once a year, so credits are refilled monthly here (lazily, on first use each month).
// Monthly subscribers are refilled by the Stripe webhook when each invoice is paid.
export async function maybeRefill(db, userId, profile) {
  if (!profile || profile.billing_interval !== 'year' || !['active', 'trialing'].includes(profile.subscription_status)) return profile;
  const plan = PLANS[profile.plan];
  if (!plan || !profile.credits_period_start) return profile;
  const next = new Date(profile.credits_period_start); next.setMonth(next.getMonth() + 1);
  const end = profile.current_period_end ? new Date(profile.current_period_end) : null;
  if (new Date() < next || (end && new Date() > end)) return profile;
  // Claim the refill atomically so two requests cannot both do it.
  const { data: claimed } = await db.from('profiles').update({ credits_period_start: new Date().toISOString() })
    .eq('id', userId).eq('credits_period_start', profile.credits_period_start).select('id');
  if (!claimed?.length) return profile;
  const { data: bal } = await db.rpc('refill_credits', { p_user: userId, p_amount: plan.credits, p_reason: 'monthly_refill', p_ref: 'annual' });
  return { ...profile, credits: bal, credits_period_start: new Date().toISOString() };
}
