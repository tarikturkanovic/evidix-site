// Thin client for the Higgsfield API (server-side only). Credentials never reach the browser.
const BASE = 'https://api.higgsfield.ai';

function creds() {
  const key = process.env.HIGGSFIELD_API_KEY, secret = process.env.HIGGSFIELD_API_SECRET;
  if (!key) { const e = new Error('Higgsfield is not configured'); e.code = 'NOT_CONFIGURED'; throw e; }
  return key.includes(':') || !secret ? key : key + ':' + secret;
}
const headers = (extra = {}) => ({ Authorization: 'Key ' + creds(), 'Content-Type': 'application/json', Accept: 'application/json', ...extra });

export async function submitSeedance(input, idempotencyKey) {
  const r = await fetch(BASE + '/bytedance/seedance-2.5/text-to-video', {
    method: 'POST', headers: headers({ 'Idempotency-Key': idempotencyKey }), body: JSON.stringify(input),
  });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  if (!r.ok) { const e = new Error('Higgsfield submit ' + r.status + ': ' + text.slice(0, 300)); e.status = r.status; throw e; }
  if (!j.request_id) throw new Error('Higgsfield returned no request_id');
  return j.request_id;
}

export async function getStatus(requestId) {
  const r = await fetch(BASE + '/requests/' + encodeURIComponent(requestId) + '/status', { headers: headers() });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  if (!r.ok) { const e = new Error('Higgsfield status ' + r.status + ': ' + text.slice(0, 300)); e.status = r.status; throw e; }
  const videoUrl = j.video?.url || j.videos?.[0]?.url || j.result?.video?.url || null;
  return { status: j.status || 'queued', videoUrl, raw: j };
}
