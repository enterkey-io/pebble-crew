import { describe, expect, it } from 'vitest';
import { ownerBubbleStyle } from './bubble-color';
import { COLORS } from '../avatar-lab/engine';
describe('owner message colors', () => {
  it('matches the selected Pebble and uses dark text on its muted color', () => {
    for (const color of COLORS.filter((item) => item.id !== 'white'))
      expect(ownerBubbleStyle(color.id)).toEqual({ backgroundColor: color.hex, color: '#101112' });
  });
  it('calls the existing white identity Snow and keeps neutral bubbles', () => {
    expect(COLORS.find((item) => item.id === 'white')?.label).toBe('Snow');
    expect(ownerBubbleStyle('white')).toEqual({});
    expect(ownerBubbleStyle()).toEqual({});
  });
});
