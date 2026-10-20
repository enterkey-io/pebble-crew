// Presentation metadata: https://developers.openai.com/api/docs/guides/live-conversations#voice-options
const female = new Set([
  'quartz',
  'willow',
  'gleam',
  'bossa',
  'delta',
  'nuri',
  'juni',
  'brise',
  'nira',
  'harema',
  'noeul',
]);
const male = new Set([
  'ripple',
  'vesper',
  'stone',
  'meridian',
  'tempo',
  'beacon',
  'cinder',
  'flitz',
  'sillage',
  'shida',
]);

export function voiceGroups(voices: string[]) {
  const groups: Record<'Female' | 'Male' | 'Other', string[]> = { Female: [], Male: [], Other: [] };
  for (const voice of new Set(voices)) {
    const label = female.has(voice) ? 'Female' : male.has(voice) ? 'Male' : 'Other';
    groups[label].push(voice);
  }
  return Object.entries(groups)
    .filter(([, voices]) => voices.length)
    .map(([label, voices]) => ({ label, voices }));
}
