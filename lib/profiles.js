// Video-generator profiles. Kept separate from the creative instructions so new generators can be added
// without touching the director prompts. Only put facts here once they are VERIFIED for that generator.
//
// maxPartSeconds: longest single clip we plan for. UNVERIFIED assumption for Higgsfield: models differ, so
//   confirm per model and edit here (one place) when you know the real limits.
// wordTargets:    [min, max] useful words per prompt, for a part of maxPartSeconds, per detail level
//                 (shorter parts scale down). Flexible targets, never a reason to pad.
export const PROFILES = {
  Higgsfield: {
    label: 'Higgsfield',
    verified: false,
    maxPartSeconds: 15,
    wordTargets: { standard: [200, 450], detailed: [500, 900], advanced: [900, 1400] },
    notes: [
      'Write each part as one continuous prompt with a timestamped shot-by-shot timeline.',
      'Dialogue goes in quotes with the speaker named and the delivery described. Keep lines short enough to be spoken in their time slot.',
      'Exact on-screen text and UI are unreliable in video models: keep text short and suggest an overlay in editing when exact text matters.',
    ],
  },
  // Fallback for any generator without a verified profile. Add Seedance, Veo, etc. here once verified.
  generic: {
    label: 'Generic AI video generator',
    verified: false,
    maxPartSeconds: 10,
    wordTargets: { standard: [150, 350], detailed: [350, 650], advanced: [600, 1000] },
    notes: ['Write each part as one continuous prompt with a timestamped shot-by-shot timeline.'],
  },
};

export function profileFor(generator) {
  return PROFILES[generator] || PROFILES.generic;
}
