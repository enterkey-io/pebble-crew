import type { Activity } from '../avatar-lab/engine';

export type PebblePresence = { state?: Activity | undefined; unread?: boolean };

export type AvatarStatus = 'attention' | 'unread' | 'active';
export function avatarStatus({ state, unread = false }: PebblePresence): AvatarStatus | undefined {
  if (state === 'attention') return 'attention';
  if (unread) return 'unread';
  if (state === 'thinking' || state === 'working') return 'active';
  return undefined;
}
export const statusLabels: Record<AvatarStatus, string> = {
  active: 'Active',
  attention: 'Needs attention',
  unread: 'Unread messages',
};
