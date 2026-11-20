// Video-generator profiles. Kept separate from the creative instructions so new generators can be added
// without touching the director prompt. Only put facts here once they are VERIFIED for that generator.
//
// maxPartSeconds: longest single clip we plan for. UNVERIFIED assumption for Higgsfield: models differ, so
//   confirm per model and edit here (one place) when you know the real limits.
// charBudget:     soft cap on characters per part prompt for each detail level (keeps prompts pasteable).
export const PROFILES = {
  Higgsfield: {
    label: 'Higgsfield',
    verified: false,
    maxPartSeconds: 15,
    charBudget: { standard: 1400, detailed: 2400, advanced: 3600 },
    notes: [
      'Write each part as one continuous prompt with a timestamped timeline.',
      'Dialogue goes in quotes with the speaker named. Keep lines short enough to be spoken in their time slot.',
      'Exact on-screen text and UI are unreliable in video models: keep text short and suggest an overlay in editing when exact text matters.',
    ],
  },
  // Fallback for any generator without a verified profile. Add Seedance, Veo, etc. here once verified.
  generic: {
    label: 'Generic AI video generator',
    verified: false,
    maxPartSeconds: 10,
    charBudget: { standard: 1200, detailed: 2000, advanced: 3000 },
    notes: ['Write each part as one continuous prompt with a timestamped timeline.'],
  },
};

export function profileFor(generator) {
  return PROFILES[generator] || PROFILES.generic;
}
