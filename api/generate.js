import { PLANS } from '../lib/plans.js';
import { validateSettings, generatePlan } from '../lib/generate.js';
import { admin, authUser, send } from '../lib/server.js';

// POST /api/generate  { settings, projectId?, sceneIndexes? }
// Requires a signed-in user. Limits are enforced here with an atomic database call.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  const db = admin();
  const user = await authUser(req, db);
  if (!user) return send(res, 401, { error: 'Please sign in.' });
  const body = req.body || {};

  let settings = body.settings, previous = null;
  if (body.projectId) { // regenerate: use the stored settings, never trust the browser's copy
    const { data } = await db.from('projects').select('settings, plan').eq('id', body.projectId).eq('user_id', user.id).single();
    if (!data) return send(res, 404, { error: 'Project not found.' });
    settings = data.settings; previous = data.plan;
  }
  const problems = validateSettings(settings);
  if (problems.length) return send(res, 400, { error: problems.join('; ') });
  if (body.sceneIndexes && !(Array.isArray(body.sceneIndexes) && body.sceneIndexes.every(Number.isInteger))) return send(res, 400, { error: 'Invalid scene selection.' });

  const { data: profile } = await db.from('profiles').select('plan, subscription_status').eq('id', user.id).single();
  const key = profile?.plan || 'free', plan = PLANS[key];
  if (key !== 'free' && !['active', 'trialing'].includes(profile.subscription_status)) return send(res, 402, { error: 'Your subscription is not active.' });
  if (!plan.detail.includes(settings.detail)) return send(res, 403, { error: `Your plan does not include ${settings.detail} prompts. Choose a lower detail level or upgrade.` });

  const { data: allowed, error: rpcError } = await db.rpc('consume_generation', { p_user: user.id, p_limit: plan.monthlyGenerations });
  if (rpcError) { console.error('[consume_generation]', rpcError.message); return send(res, 500, { error: 'Something went wrong on our side. Please try again.' }); }
  if (!allowed) return send(res, 429, { error: 'You have used all your generations for this period.', code: 'LIMIT' });

  try {
    const result = await generatePlan(settings, { previousPlan: previous, sceneIndexes: body.sceneIndexes, attempts: 2 });
    const row = { user_id: user.id, title: result.title, idea: settings.idea, settings, plan: result, updated_at: new Date().toISOString() };
    const q = body.projectId ? db.from('projects').update(row).eq('id', body.projectId).eq('user_id', user.id) : db.from('projects').insert(row);
    const { data: saved, error } = await q.select('id').single();
    if (error) throw error;
    send(res, 200, { projectId: saved.id });
  } catch (err) {
    await db.rpc('refund_generation', { p_user: user.id }); // failed generations do not count
    if (err.code === 'NOT_CONFIGURED') return send(res, 503, { error: 'AI generation is not configured yet.' });
    send(res, 502, { error: 'We could not generate your plan this time. It did not use a generation. Please try again.', reason: String(err.message || '').slice(0, 400) });
  }
}
