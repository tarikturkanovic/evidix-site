// Deterministic quality review. No AI call: cheap, fast, and the same result every time.
// Both reviews return { hard: [...], soft: [...] }.
//   hard = unusable (bad timing, parts that do not cover the video, an empty prompt) -> must be fixed or retried
//   soft = quality problems (dialogue too long for its slot, vague lighting, prompt too thin, missing sections)
//          -> retried once with feedback if time allows, otherwise the best attempt is kept.

export const WORDS_PER_SECOND = 2.5;   // natural speaking rate, with room for expression
export const LINE_PAUSE_SECONDS = 0.5; // reaction/breath time per spoken line

const VAGUE = /^(cinematic|beautiful|professional|high[- ]quality|nice|good|dramatic|moody|stunning)( lighting)?[.\s]*$/i;

export const SECTIONS = {
  full: ['CREATIVE DIRECTION', 'CHARACTER BIBLE', 'ENVIRONMENT', 'SHOT-BY-SHOT TIMELINE', 'CHARACTER PERFORMANCE', 'CINEMATOGRAPHY', 'LIGHTING AND RENDERING', 'DIALOGUE AND AUDIO', 'PHYSICAL CONTINUITY', 'FINAL QUALITY REQUIREMENTS'],
  short: ['CHARACTERS', 'SETTING', 'TIMELINE', 'AUDIO', 'CONTINUITY'],
};
export const sectionsFor = (detail) => (detail === 'standard' ? SECTIONS.short : SECTIONS.full);

export const countWords = (t) => (t || '').split(/\s+/).filter(Boolean).length;

// "NAME: "line"" per line -> [{speaker, text}]
export function parseDialogue(d) {
  if (!d || !d.trim()) return [];
  return d.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    const text = (i > -1 ? l.slice(i + 1) : l).replace(/["“”]/g, '').trim();
    return { speaker: i > -1 ? l.slice(0, i).trim() : '', text };
  }).filter((x) => x.text);
}

export function speakingSeconds(lines) {
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  return words / WORDS_PER_SECOND + lines.length * LINE_PAUSE_SECONDS;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Quoted lines the customer wrote in their idea must survive into the plan.
export function requestedQuotes(idea) {
  const out = [];
  const re = /["“]([^"”]{8,200})["”]/g; let m;
  while ((m = re.exec(idea || ''))) out.push(m[1]);
  return out;
}

// Word range for one part (targets are for a full-length part; shorter parts scale down, never below half).
export function wordRange(profile, detail, partSeconds) {
  const [lo, hi] = profile.wordTargets[detail] || profile.wordTargets.detailed;
  const k = Math.max(0.5, Math.min(1, partSeconds / profile.maxPartSeconds));
  return [Math.round(lo * k), Math.round(hi * k)];
}

// Stage A review: the director's brief and scene plan (parts have timing only at this point).
export function reviewPlan(plan, settings, profile) {
  const hard = [], soft = [];
  const dur = settings.duration, max = profile.maxPartSeconds;
  const scenes = plan.scenes || [], parts = plan.parts || [];

  let prev = 0;
  parts.forEach((x, i) => {
    if (x.start !== prev) hard.push(`parts[${i}] must start at ${prev}s (starts at ${x.start}s)`);
    if (x.end - x.start > max) hard.push(`parts[${i}] is ${x.end - x.start}s but the clip limit is ${max}s`);
    prev = x.end;
  });
  if (parts.length && prev !== dur) hard.push(`parts must end at ${dur}s (end at ${prev}s)`);
  const needed = Math.ceil(dur / max);
  if (parts.length < needed) hard.push(`need at least ${needed} parts for ${dur}s with a ${max}s clip limit`);

  const bounds = new Set(scenes.flatMap((s) => [s.start, s.end]));
  parts.forEach((x, i) => { if (i > 0 && !bounds.has(x.start)) soft.push(`part ${i + 1} starts at ${x.start}s which is not a scene boundary; end a scene at ${x.start}s`); });
  if (parts.length > 1) parts.forEach((x, i) => { if (!x.startState || !x.endState) soft.push(`part ${i + 1} needs startState and endState so the parts join`); });

  scenes.forEach((s, i) => {
    const lines = parseDialogue(s.dialogue);
    const slot = s.end - s.start;
    if (settings.audio === 'No Dialogue' && lines.length) soft.push(`scene ${i + 1} has dialogue but the audio setting is No Dialogue`);
    if (lines.length) {
      const need = speakingSeconds(lines);
      if (need > slot + 0.01) soft.push(`scene ${i + 1} (${s.start}-${s.end}s) dialogue needs about ${need.toFixed(1)}s but only ${slot}s are available: shorten it or give the scene more time`);
      if (lines.some((l) => !l.speaker)) soft.push(`scene ${i + 1} dialogue has a line without a named speaker`);
    }
    if (VAGUE.test((s.lighting || '').trim()) || (s.lighting || '').trim().length < 30) soft.push(`scene ${i + 1} lighting is vague: name the light source, direction, quality and colours`);
    if ((s.action || '').trim().length < 60) soft.push(`scene ${i + 1} action is too thin: say who, where, what they physically do and how they move`);
  });

  if (!plan.brief || typeof plan.brief !== 'object') soft.push('the director brief (brief object) is missing');
  const haystack = norm(JSON.stringify(scenes.map((s) => s.dialogue || '')));
  requestedQuotes(settings.idea).forEach((q) => { if (!haystack.includes(norm(q))) soft.push(`the customer's line "${q}" is missing from the scene dialogue`); });
  return { hard, soft };
}

// Stage B review: one finished prompt for one part. ctx = { settings, profile, part:{start,end}, scenes, characters }
export function reviewPart(text, ctx) {
  const hard = [], soft = [];
  const { settings, profile, part } = ctx;
  const words = countWords(text);
  if (words < 40) { hard.push(`prompt is only ${words} words`); return { hard, soft }; }
  const [lo, hi] = wordRange(profile, settings.detail, part.end - part.start);
  if (words < lo * 0.8) soft.push(`prompt is ${words} words; aim for ${lo}-${hi} useful words by adding more actionable direction (performance, camera, lighting, continuity), not repetition`);
  if (words > hi * 1.25) soft.push(`prompt is ${words} words; keep it within ${lo}-${hi} by cutting repetition, never dialogue or continuity`);

  sectionsFor(settings.detail).forEach((h) => { if (!new RegExp('^\\s*[#*\\-]*\\s*' + h.replace(/[-]/g, '\\-') + '\\b', 'im').test(text)) soft.push(`missing the "${h}" section`); });

  const here = (ctx.scenes || []).filter((s) => s.start < part.end && s.end > part.start);
  const present = new Set(here.flatMap((s) => (Array.isArray(s.characters) ? s.characters : [])));
  (ctx.characters || []).map((c) => c.name).filter((n) => present.has(n)).forEach((n) => {
    if (!text.toLowerCase().includes(n.toLowerCase())) soft.push(`the prompt never mentions character "${n}" who appears in it`);
  });

  const t = norm(text);
  const missing = [];
  here.forEach((s) => parseDialogue(s.dialogue).forEach((l) => { if (l.text.split(/\s+/).length >= 2 && !t.includes(norm(l.text))) missing.push(l.text); }));
  missing.slice(0, 3).forEach((m) => soft.push(`dialogue line "${m}" is missing from the prompt`));

  if (settings.audio === 'Dialogue Only' && !/no (background )?music/i.test(text)) soft.push('the prompt must state that there is no music (audio is Dialogue Only)');
  if (settings.audio === 'No Dialogue' && !/no (spoken )?(dialogue|speech|voices?)/i.test(text)) soft.push('the prompt must state that there is no spoken dialogue');
  return { hard, soft };
}
