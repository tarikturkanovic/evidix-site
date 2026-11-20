// Deterministic quality review. No AI call: cheap, fast, and the same result every time.
// Returns { hard: [...], soft: [...] }.
//   hard = the plan is unusable (bad timing, parts that do not cover the video) -> must be fixed or retried
//   soft = quality problems (dialogue too long for its slot, vague lighting, missing character details)
//          -> retried once with feedback if time allows, otherwise the best attempt is kept.

export const WORDS_PER_SECOND = 2.5;   // natural speaking rate, with room for expression
export const LINE_PAUSE_SECONDS = 0.5; // reaction/breath time per spoken line

const VAGUE = /^(cinematic|beautiful|professional|high[- ]quality|nice|good|dramatic|moody|stunning)( lighting)?[.\s]*$/i;

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

export function reviewPlan(plan, settings, profile) {
  const hard = [], soft = [];
  const dur = settings.duration, max = profile.maxPartSeconds;
  const scenes = plan.scenes || [], parts = plan.parts || [];

  // --- parts must cover the whole video, contiguous, each within the generator's clip limit (hard)
  let prev = 0;
  parts.forEach((x, i) => {
    if (x.start !== prev) hard.push(`parts[${i}] must start at ${prev}s (starts at ${x.start}s)`);
    if (x.end - x.start > max) hard.push(`parts[${i}] is ${x.end - x.start}s but the clip limit is ${max}s`);
    prev = x.end;
  });
  if (parts.length && prev !== dur) hard.push(`parts must end at ${dur}s (end at ${prev}s)`);
  const needed = Math.ceil(dur / max);
  if (parts.length < needed) hard.push(`need at least ${needed} parts for ${dur}s with a ${max}s clip limit`);

  // --- part boundaries should fall on scene boundaries so no scene is split across two clips
  const bounds = new Set(scenes.flatMap((s) => [s.start, s.end]));
  parts.forEach((x, i) => { if (i > 0 && !bounds.has(x.start)) soft.push(`part ${i + 1} starts at ${x.start}s which is not a scene boundary; end a scene at ${x.start}s`); });

  // --- dialogue timing and audio rules
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

  // --- characters named in a part's scenes must be described again in that part's prompt (consistency)
  const names = (plan.characters || []).map((c) => c.name);
  parts.forEach((x, i) => {
    const inPart = scenes.filter((s) => s.start < x.end && s.end > x.start);
    const present = new Set(inPart.flatMap((s) => Array.isArray(s.characters) ? s.characters : []));
    names.filter((n) => present.has(n)).forEach((n) => {
      if (!x.prompt.toLowerCase().includes(n.toLowerCase())) soft.push(`part ${i + 1} prompt never mentions character "${n}" who appears in it`);
    });
    if (parts.length > 1 && (!x.startState || !x.endState)) soft.push(`part ${i + 1} needs startState and endState so the parts join`);
    if (x.prompt.length > profile.charBudget[settings.detail]) soft.push(`part ${i + 1} prompt is ${x.prompt.length} characters; keep it under ${profile.charBudget[settings.detail]} without dropping dialogue or continuity`);
    if (settings.audio === 'Dialogue Only' && !/no (background )?music/i.test(x.prompt)) soft.push(`part ${i + 1} prompt must state that there is no music (audio is Dialogue Only)`);
    if (settings.audio === 'No Dialogue' && !/no (spoken )?(dialogue|speech)/i.test(x.prompt)) soft.push(`part ${i + 1} prompt must state that there is no spoken dialogue`);
  });

  // --- the customer's own quoted lines must be preserved
  const haystack = norm(JSON.stringify(scenes.map((s) => s.dialogue || '')) + ' ' + parts.map((p) => p.prompt).join(' '));
  requestedQuotes(settings.idea).forEach((q) => { if (!haystack.includes(norm(q))) soft.push(`the customer's line "${q}" is missing from the plan`); });

  return { hard, soft };
}
