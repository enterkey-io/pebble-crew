import { expect, it } from 'vitest';
import { session, receive, resolve, descendants } from './plan-session';
it('preserves local edits and incorporates unrelated remote changes', () => {
  const original = { title: 'Launch', outcome: 'Ten customers' };
  const edit = { ...session(original, 1), draft: { ...original, title: 'New launch' } };
  const next = receive(edit, { ...original, outcome: 'Twenty customers' }, 2, ['title', 'outcome']);
  expect(next.draft).toEqual({ title: 'New launch', outcome: 'Twenty customers' });
  expect(next.conflicts).toEqual([]);
  expect(next.revision).toBe(2);
});
it('requires a decision for conflicting changes across repeated refreshes', () => {
  const edit = { ...session({ outcome: 'A' }, 1), draft: { outcome: 'Mine' } };
  const incoming = receive(edit, { outcome: 'Theirs' }, 2, ['outcome']);
  expect(incoming.conflicts).toEqual(['outcome']);
  const again = receive(incoming, { outcome: 'Theirs' }, 3, ['outcome']);
  expect(again.conflicts).toEqual(['outcome']);
  expect(resolve(again, true).draft.outcome).toBe('Theirs');
  expect(resolve(again, false).draft.outcome).toBe('Mine');
});
it('rejects self and descendant choices before displaying parent candidates', () => {
  expect([
    ...descendants(
      [
        { id: 'a', parentId: null },
        { id: 'b', parentId: 'a' },
        { id: 'c', parentId: 'b' },
      ],
      'a',
    ),
  ]).toEqual(['a', 'b', 'c']);
});
