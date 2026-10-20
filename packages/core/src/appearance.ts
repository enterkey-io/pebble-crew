export const SHAPES = [
  'pebble',
  'beacon',
  'petal',
  'kite',
  'arch',
  'cairn',
  'seed',
  'dune',
  'flint',
  'drift',
] as const;
export type Shape = (typeof SHAPES)[number];
export const APPEARANCE_COLORS = [
  'iris',
  'citron',
  'clay',
  'lagoon',
  'rose',
  'sky',
  'white',
  'umber',
  'moss',
  'ocean',
  'heather',
  'sienna',
] as const;
