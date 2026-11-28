import { expect, it } from 'vitest';
import { avatarStatus } from './avatar-status';

it('gives attention priority, then unread, then active, and leaves idle avatars unmarked', () => {
  expect(avatarStatus({ state: 'attention', unread: true })).toBe('attention');
  expect(avatarStatus({ state: 'working', unread: true })).toBe('unread');
  expect(avatarStatus({ state: 'thinking' })).toBe('active');
  expect(avatarStatus({ state: 'working' })).toBe('active');
  for (const state of ['ready', 'done', 'waiting'] as const)
    expect(avatarStatus({ state })).toBeUndefined();
});
