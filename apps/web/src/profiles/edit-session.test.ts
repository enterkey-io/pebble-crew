import { describe, expect, it } from 'vitest';
import { emptyProfile, profileSession, profileReducer, profileDirty } from './edit-session';
import { roleInstructions, withRoleInstructions } from '@hermes-client/protocol';

describe('profile edit ownership', () => {
  it('clears every instruction conflict when a clean draft adopts an entire incoming card', () => {
    const base = emptyProfile();
    const edit = {
      ...profileSession(base, 'native-1', 1),
      conflicts: ['role.responsibilities', 'role.boundaries', 'role.expectedOutputs'] as const,
    };
    const incoming = {
      ...base,
      role: { ...base.role, responsibilities: 'Read sources', boundaries: 'Ask before publishing' },
    };
    const next = profileReducer(
      { ...edit, conflicts: [...edit.conflicts] },
      { type: 'receive', identity: 'native-1', revision: 2, values: incoming },
    );
    expect(next.draft.role).toEqual(incoming.role);
    expect(next.conflicts).toEqual([]);
  });
  it('keeps the entire instruction draft when an agent edits an older separate field', () => {
    const base = emptyProfile();
    const draft = { ...base, role: withRoleInstructions(base.role, 'My unsaved instructions') };
    let edit = profileReducer(
      { ...profileSession(base, 'native-1', 1), draft },
      {
        type: 'receive',
        identity: 'native-1',
        revision: 2,
        values: { ...base, role: { ...base.role, boundaries: 'A concurrent saved boundary' } },
      },
    );
    expect(roleInstructions(edit.draft.role)).toBe('My unsaved instructions');
    expect(edit.conflicts).toContain('role.boundaries');
    edit = profileReducer(edit, { type: 'resolve', section: 'role', useSaved: true });
    expect(roleInstructions(edit.draft.role)).toBe('Boundaries:\nA concurrent saved boundary');
    expect(edit.conflicts).toEqual([]);
  });
  it('ignores a delayed snapshot older than the accepted native revision', () => {
    const newer = { ...emptyProfile(), name: 'Newer saved name' };
    const edit = profileSession(newer, 'native-1', 3);
    expect(
      profileReducer(edit, {
        type: 'receive',
        identity: 'native-1',
        revision: 2,
        values: { ...newer, name: 'Older saved name' },
      }),
    ).toBe(edit);
  });
  it('keeps dirty fields, adopts clean fields and exposes divergent edits', () => {
    const base = { ...emptyProfile(), name: 'Arlo', handle: 'arlo' };
    let edit = profileReducer(profileSession(base, 'native-1', 1), {
      type: 'change',
      patch: { name: 'My Arlo' },
    });
    edit = profileReducer(edit, {
      type: 'receive',
      identity: 'native-1',
      revision: 2,
      values: { ...base, name: 'Remote Arlo', role: { ...base.role, title: 'Researcher' } },
    });
    expect(edit.draft.name).toBe('My Arlo');
    expect(edit.draft.role.title).toBe('Researcher');
    expect(edit.conflicts).toEqual(['name']);
    edit = profileReducer(edit, { type: 'resolve', section: 'profile', useSaved: false });
    expect(edit.conflicts).toEqual([]);
    expect(profileDirty(edit)).toBe(true);
  });
  it('does not attach a retained draft to a replacement native identity', () => {
    const edit = profileReducer(profileSession(emptyProfile(), 'native-1', 1), {
      type: 'receive',
      identity: 'native-2',
      revision: 2,
      values: { ...emptyProfile(), name: 'Replacement' },
    });
    expect(edit.retired).toBe(true);
    expect(edit.draft.name).toBe('');
  });
  it('keeps later edits and unrelated fields after a role save', () => {
    const base = emptyProfile();
    const submitted = { ...base, role: { ...base.role, title: 'Researcher' } };
    const draft = {
      ...submitted,
      name: 'Unsaved name',
      role: { ...submitted.role, title: 'Later title' },
    };
    const edit = profileReducer(
      { ...profileSession(base, 'native-1', 1), draft },
      { type: 'saved', submitted, section: 'role' },
    );
    expect(edit.draft.name).toBe('Unsaved name');
    expect(edit.draft.role.title).toBe('Later title');
    expect(edit.baseline.name).toBe('');
    expect(edit.baseline.role.title).toBe('Researcher');
  });
  it('preserves a selected photo and a saved photo while switching back to a shape', () => {
    const base = emptyProfile();
    let edit = profileReducer(profileSession(base, 'native-1', 1), {
      type: 'change',
      patch: {
        photo: 'data:image/png;base64,synthetic',
        appearance: { ...base.appearance, kind: 'photo' },
      },
    });
    edit = profileReducer(edit, {
      type: 'receive',
      identity: 'native-1',
      revision: 2,
      values: base,
    });
    expect(edit.draft.photo).toContain('synthetic');
    edit = profileReducer(edit, { type: 'change', patch: { appearance: base.appearance } });
    expect(edit.draft.photo).toContain('synthetic');
  });
});
