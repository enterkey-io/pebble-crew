import { describe, it, expect } from 'vitest';
import { reconcileNativeApprovals } from './native-approvals';
import type { ConversationApproval } from '@hermes-client/protocol';

const request = (requestId: string): ConversationApproval => ({
  target: { kind: 'chat', sessionId: 'session', requestId },
  description: `Review ${requestId}`,
});
describe('native approval review history', () => {
  it('retains two withdrawn requests as inactive receipts instead of deleting their cards', () => {
    const pending = reconcileNativeApprovals([], [request('one'), request('two')]);
    expect(pending.map((row) => row.state)).toEqual(['pending', 'pending']);
    const missing = reconcileNativeApprovals(pending, []);
    expect(missing.map((row) => [row.description, row.state])).toEqual([
      ['Review one', 'inactive'],
      ['Review two', 'inactive'],
    ]);
    expect(reconcileNativeApprovals(missing, [request('two')]).map((row) => row.state)).toEqual([
      'inactive',
      'pending',
    ]);
  });
  it('cannot restore an already confirmed decision from an older pending snapshot', () => {
    const first = { ...request('one'), state: 'approved' as const };
    expect(
      reconcileNativeApprovals([first], [request('one'), request('two')]).map((row) => row.state),
    ).toEqual(['approved', 'pending']);
  });
  it('does not turn a lost decision into consent or permission to retry', () => {
    const uncertain = { ...request('one'), state: 'uncertain' as const };
    expect(reconcileNativeApprovals([uncertain], [request('one')])[0]?.state).toBe('uncertain');
    expect(reconcileNativeApprovals([uncertain], [])[0]?.state).toBe('uncertain');
  });
});
