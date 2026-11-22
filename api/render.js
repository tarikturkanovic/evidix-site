import { PLANS, RENDER } from '../lib/plans.js';
import { submitSeedance, getStatus } from '../lib/higgsfield.js';
import { admin, authUser, send } from '../lib/server.js';

const TERMINAL = ['completed', 'failed', 'nsfw', 'canceled'];
const ASPECTS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
const pub = (r) => ({ id: r.id, projectId: r.project_id, part: r.part_index, status: r.status, resolution: r.resolution, duration: r.duration, credits: r.credits, videoUrl: r.video_url, error: r.error, createdAt: r.created_at });

// Give the credits back once, even if two requests notice the failure at the same time.
async function refundOnce(db, row, reason) {
  const { data } = await db.from('renders').update({ refunded: true }).eq('id', row.id).eq('refunded', false).select('id');
  if (data?.length) await db.rpc('add_credits', { p_user: row.user_id, p_amount: row.credits, p_reason: reason, p_ref: row.id });
}

export default async function handler(req, res) {
  const db = admin();
  const user = await authUser(req, db);
  if (!user) return send(res, 401, { error: 'Please sign in.' });

  if (req.method === 'GET') {
    if (req.query?.projectId) {
      const { data } = await db.from('renders').select('*').eq('user_id', user.id).eq('project_id', req.query.projectId).order('created_at', { ascending: false }).limit(50);
      return send(res, 200, { renders: (data || []).map(pub) });
    }
    const { data: row } = await db.from('renders').select('*').eq('id', req.query?.id || '').eq('user_id', user.id).maybeSingle();
    if (!row) return send(res, 404, { error: 'Render not found.' });
    if (TERMINAL.includes(row.status) || !row.request_id) return send(res, 200, { render: pub(row) });
    try {
      const s = await getStatus(row.request_id);
      const patch = { status: s.status, updated_at: new Date().toISOString() };
      if (s.status === 'completed') patch.video_url = s.videoUrl;
      if (['failed', 'nsfw', 'canceled'].includes(s.status)) patch.error = s.status === 'nsfw' ? 'This was blocked by the content filter.' : 'The render failed.';
      const { data: upd } = await db.from('renders').update(patch).eq('id', row.id).select('*').single();
      const cur = upd || { ...row, ...patch };
      if (['failed', 'nsfw', 'canceled'].includes(s.status)) await refundOnce(db, cur, 'refund_render');
      return send(res, 200, { render: pub(cur) });
    } catch (e) {
      console.error('[render status]', e.message);
      return send(res, 200, { render: pub(row) });
    }
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  const body = req.body || {};
  const resolution = body.resolution;
  const rate = RENDER.perSecond[resolution];
  if (!rate) return send(res, 400, { error: 'Choose 480p or 720p.' });

  const { data: profile } = await db.from('profiles').select('plan, subscription_status').eq('id', user.id).single();
  const key = profile?.plan || 'free';
  if (key === 'free' || !PLANS[key] || !['active', 'trialing'].includes(profile.subscription_status)) return send(res, 402, { error: 'Video rendering needs a paid plan.', code: 'PLAN' });

  const { data: project } = await db.from('projects').select('settings, plan').eq('id', body.projectId || '').eq('user_id', user.id).maybeSingle();
  const part = project?.plan?.parts?.[body.part];
  if (!part || typeof part.prompt !== 'string' || !part.prompt.trim()) return send(res, 400, { error: 'Part not found.' });

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db.from('renders').select('id', { count: 'exact', head: true }).eq('user_id', user.id).in('status', ['queued', 'in_progress']).gte('created_at', since);
  if ((count || 0) >= RENDER.maxActive) return send(res, 429, { error: 'You have renders still running. Wait for them to finish.' });

  const span = Math.round((Number(part.end) || 0) - (Number(part.start) || 0));
  const duration = Math.min(RENDER.maxSeconds, Math.max(RENDER.minSeconds, span || RENDER.minSeconds));
  const credits = rate * duration;

  const { data: balance, error: rpcError } = await db.rpc('spend_credits', { p_user: user.id, p_cost: credits, p_reason: 'render', p_ref: body.projectId });
  if (rpcError) { console.error('[spend_credits]', rpcError.message); return send(res, 500, { error: 'Something went wrong on our side. Please try again.' }); }
  if (balance < 0) return send(res, 402, { error: 'This render costs ' + credits + " credits and you don't have enough. Top up or upgrade your plan.", code: 'CREDITS', cost: credits });

  const { data: row, error: insErr } = await db.from('renders').insert({ user_id: user.id, project_id: body.projectId, part_index: body.part, resolution, duration, credits }).select('*').single();
  if (insErr) { await db.rpc('add_credits', { p_user: user.id, p_amount: credits, p_reason: 'refund_render', p_ref: body.projectId }); return send(res, 500, { error: 'Could not start the render. Your credits were returned.' }); }

  try {
    const aspect = ASPECTS.includes(project.settings?.aspect) ? project.settings.aspect : '16:9';
    const requestId = await submitSeedance({
      prompt: part.prompt, duration, resolution, aspect_ratio: aspect, output_format: 'mp4', generate_audio: project.settings?.audio !== 'No Dialogue',
    }, row.id);
    await db.from('renders').update({ request_id: requestId, updated_at: new Date().toISOString() }).eq('id', row.id);
    return send(res, 200, { render: pub({ ...row, request_id: requestId }), credits: balance });
  } catch (e) {
    console.error('[render submit]', e.message);
    await db.from('renders').update({ status: 'failed', error: 'Could not start the render.', updated_at: new Date().toISOString() }).eq('id', row.id);
    await refundOnce(db, row, 'refund_render');
    if (e.code === 'NOT_CONFIGURED') return send(res, 503, { error: 'Video rendering is not set up yet.' });
    return send(res, 502, { error: 'Could not start the render. Your credits were returned.' });
  }
}
