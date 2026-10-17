import { describe, expect, it } from 'vitest';
import { emptyPolicyEdit, reducePolicyEdit, policyDirty } from './edit-session';
import type { Permission } from './model';

const permission = (names: string[], fingerprint = 'first'): Permission => ({
  fingerprint,
  policy: { kind: 'custom', names },
  bearer: true,
  oauth: false,
});
describe('connection tool editing', () => {
  it('retains an unsaved choice when reconnect refreshes the same policy', () => {
    let edit = reducePolicyEdit(emptyPolicyEdit, { type: 'receive', value: permission(['read']) });
    edit = reducePolicyEdit(edit, {
      type: 'change',
      value: { kind: 'custom', names: ['read', 'write'] },
    });
    edit = reducePolicyEdit(edit, { type: 'receive', value: permission(['read'], 'refreshed') });
    expect(edit.draft).toEqual({ kind: 'custom', names: ['read', 'write'] });
    expect(policyDirty(edit)).toBe(true);
    expect(edit.kind === 'ready' && edit.conflict).toBe(false);
  });
  it('requires explicit resolution when remote policy diverges', () => {
    let edit = reducePolicyEdit(emptyPolicyEdit, { type: 'receive', value: permission(['read']) });
    edit = reducePolicyEdit(edit, { type: 'change', value: { kind: 'custom', names: ['write'] } });
    edit = reducePolicyEdit(edit, { type: 'receive', value: permission(['search'], 'elsewhere') });
    expect(edit.kind === 'ready' && edit.conflict).toBe(true);
    expect(edit.draft).toEqual({ kind: 'custom', names: ['write'] });
    const discarded = reducePolicyEdit(edit, { type: 'discard' });
    expect(discarded.draft).toEqual({ kind: 'custom', names: ['search'] });
    expect(policyDirty(discarded)).toBe(false);
    const kept = reducePolicyEdit(edit, { type: 'keep' });
    expect(kept.draft).toEqual({ kind: 'custom', names: ['write'] });
    expect(kept.kind === 'ready' && kept.base.fingerprint).toBe('elsewhere');
  });
  it('clears only the submitted edit after a confirmed save', () => {
    let edit = reducePolicyEdit(emptyPolicyEdit, { type: 'receive', value: permission(['read']) });
    edit = reducePolicyEdit(edit, {
      type: 'change',
      value: { kind: 'custom', names: ['read', 'write'] },
    });
    edit = reducePolicyEdit(edit, {
      type: 'saved',
      submitted: { kind: 'custom', names: ['read'] },
      value: permission(['read'], 'saved'),
    });
    expect(edit.draft).toEqual({ kind: 'custom', names: ['read', 'write'] });
    expect(policyDirty(edit)).toBe(true);
  });
});
