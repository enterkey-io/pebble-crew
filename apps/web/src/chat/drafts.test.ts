import { afterEach, expect, it, vi } from 'vitest';
import { ConversationDrafts, clearSavedDrafts } from './drafts';

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}
afterEach(() => vi.unstubAllGlobals());

it('restores exact multiline drafts separately for each workspace and conversation', () => {
  storage();
  const first = new ConversationDrafts();
  first.bind('owner-a');
  first.set('bot:aurora-id', 'A plan\nwith **details** and 🪨');
  first.set('bot:chloe-id', 'A different unsent message');
  first.set('room:crew-id', 'Crew draft');
  const reopened = new ConversationDrafts();
  reopened.bind('owner-a');
  expect(reopened.get('bot:aurora-id')).toBe('A plan\nwith **details** and 🪨');
  expect(reopened.get('bot:chloe-id')).toBe('A different unsent message');
  expect(reopened.get('room:crew-id')).toBe('Crew draft');
  expect(reopened.get('bot:replacement-aurora-id')).toBeUndefined();
  reopened.bind('owner-b');
  expect(reopened.get('bot:aurora-id')).toBeUndefined();
});

it('does not restore sent or manually erased drafts, and sign out removes only draft data', () => {
  const values = storage();
  values.set('unrelated-setting', 'keep');
  const drafts = new ConversationDrafts();
  drafts.bind('owner-a');
  drafts.set('bot:one', 'sent');
  drafts.set('bot:two', 'erase');
  drafts.set('bot:three', 'keep until sign out');
  drafts.delete('bot:one');
  drafts.set('bot:two', '');
  const reopened = new ConversationDrafts();
  reopened.bind('owner-a');
  expect(reopened.get('bot:one')).toBeUndefined();
  expect(reopened.get('bot:two')).toBeUndefined();
  clearSavedDrafts();
  expect(values).toEqual(new Map([['unrelated-setting', 'keep']]));
});

it('keeps editing usable when browser storage is blocked', () => {
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  });
  const drafts = new ConversationDrafts();
  drafts.bind('owner');
  expect(drafts.get('bot:one')).toBeUndefined();
  drafts.set('bot:one', 'still typing');
  expect(drafts.get('bot:one')).toBe('still typing');
  drafts.delete('bot:one');
  expect(drafts.get('bot:one')).toBeUndefined();
});
