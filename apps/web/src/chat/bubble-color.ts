import { COLORS } from '../avatar-lab/engine';
import type { CSSProperties } from 'react';

/** Snow and unconfigured avatars keep the neutral owner bubble. Stored color IDs stay stable. */
export function ownerBubbleStyle(color?: string): CSSProperties {
  const selected = COLORS.find((item) => item.id === color);
  return selected && selected.id !== 'white'
    ? { backgroundColor: selected.hex, color: '#101112' }
    : {};
}
