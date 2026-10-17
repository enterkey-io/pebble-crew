import { expect, it } from 'vitest';
import { emptyTools, toolReducer } from './tool-session';
it('preserves tool choices through a refresh and requires a decision for a remote conflict', () => {
  let edit = toolReducer(emptyTools, {
    type: 'receive',
    value: { skills: ['research'], toolsets: ['workspace'] },
  });
  edit = toolReducer(edit, { type: 'change', patch: { toolsets: ['workspace', 'browser'] } });
  edit = toolReducer(edit, {
    type: 'receive',
    value: { skills: ['research'], toolsets: ['workspace'] },
  });
  expect(edit.draft.toolsets).toEqual(['workspace', 'browser']);
  expect(edit.conflict).toBe(false);
  edit = toolReducer(edit, { type: 'receive', value: { skills: [], toolsets: ['workspace'] } });
  expect(edit.conflict).toBe(true);
  edit = toolReducer(edit, { type: 'resolve', useSaved: true });
  expect(edit.draft.skills).toEqual([]);
  expect(edit.draft.toolsets).toEqual(['workspace']);
});
