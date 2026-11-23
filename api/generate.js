import { PLANS, COSTS } from '../lib/plans.js';
import { validateSettings, generatePlan, fixPartPrompt } from '../lib/generate.js';
import { maybeRefill } from '../lib/credits.js';
import { admin, authUser, send } from '../lib/server.js';

// POST /api/generate  { settings, projectId?, sceneIndexes?, fix? }
// Requires a signed-in user. Credits are spent here with an atomic database call.
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
  const fix = body.fix;
  if (fix) {
    if (!body.projectId || !previous?.parts) return send(res, 400, { error: 'Open a project to fix a prompt.' });
    if (!Number.isInteger(fix.part) || fix.part < 0 || fix.part >= previous.parts.length) return send(res, 400, { error: 'Invalid part.' });
    if (typeof fix.note !== 'string' || fix.note.trim().length < 5 || fix.note.length > 600) return send(res, 400, { error: 'Describe the problem in 5-600 characters.' });
  }
  if (body.sceneIndexes && !(Array.isArray(body.sceneIndexes) && body.sceneIndexes.every(Number.isInteger))) return send(res, 400, { error: 'Invalid scene selection.' });

  const { data: profile0 } = await db.from('profiles').select('plan, subscription_status, billing_interval, credits, credits_period_start, current_period_end').eq('id', user.id).single();
  const profile = await maybeRefill(db, user.id, profile0);
  const key = profile?.plan || 'free', plan = PLANS[key] || PLANS.free;
  if (key === 'free' || !PLANS[key] || !['active', 'trialing'].includes(profile.subscription_status)) return send(res, 402, { error: 'Creating video plans needs a paid plan. Choose a plan to start.', code: 'PLAN' });
  if (!plan.detail.includes(settings.detail)) return send(res, 403, { error: `Your plan does not include ${settings.detail} prompts. Choose a lower detail level or upgrade.` });

  const cost = fix ? COSTS.fix : (body.sceneIndexes && body.sceneIndexes.length ? COSTS.scene : (body.projectId ? COSTS.improve : COSTS.plan));
  const { data: balance, error: rpcError } = await db.rpc('spend_credits', { p_user: user.id, p_cost: cost, p_reason: fix ? 'fix_prompt' : (body.projectId ? 'regenerate' : 'new_plan'), p_ref: body.projectId || null });
  if (rpcError) { console.error('[spend_credits]', rpcError.message); return send(res, 500, { error: 'Something went wrong on our side. Please try again.' }); }
  if (balance < 0) return send(res, 402, { error: `You need ${cost} credits for this and don't have enough. Top up or upgrade your plan.`, code: 'CREDITS', cost });

  try {
    const result = fix
      ? await fixPartPrompt(settings, previous, fix.part, fix.note.trim())
      : await generatePlan(settings, { previousPlan: previous, sceneIndexes: body.sceneIndexes });
    const row = { user_id: user.id, title: result.title, idea: settings.idea, settings, plan: result, updated_at: new Date().toISOString() };
    const q = body.projectId ? db.from('projects').update(row).eq('id', body.projectId).eq('user_id', user.id) : db.from('projects').insert(row);
    const { data: saved, error } = await q.select('id').single();
    if (error) throw error;
    send(res, 200, { projectId: saved.id, credits: balance, spent: cost });
  } catch (err) {
    await db.rpc('add_credits', { p_user: user.id, p_amount: cost, p_reason: 'refund_failed_generation', p_ref: body.projectId || null }); // failed generations cost nothing
    if (err.code === 'NOT_CONFIGURED') return send(res, 503, { error: 'AI generation is not configured yet.' });
    console.error('[generate failed]', err.message);
    send(res, 502, { error: 'We could not generate your plan this time. Your credits were returned. Please try again.', category: err.category || 'unknown' });
  }
}
