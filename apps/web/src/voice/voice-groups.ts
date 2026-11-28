// OpenAI: https://developers.openai.com/api/docs/guides/live-conversations#voice-options
// Grok: xAI publishes no gender; grouped by each published sample's measured pitch.
const female = new Set([
  'ara',
  'aurora',
  'carina',
  'celeste',
  'eve',
  'helix',
  'iris',
  'liora',
  'luna',
  'ursa',
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
  'altair',
  'atlas',
  'castor',
  'cosmo',
  'helios',
  'kepler',
  'leo',
  'lumen',
  'lux',
  'naksh',
  'orion',
  'perseus',
  'rex',
  'rigel',
  'sal',
  'sirius',
  'zagan',
  'zenith',
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
