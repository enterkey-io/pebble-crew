import {
  approvalKey,
  type ConversationApproval,
  type ApprovalChoice,
} from '@hermes-client/protocol';

export type NativeApprovalReview = ConversationApproval & {
  readonly decision?: ApprovalChoice;
  readonly state: 'pending' | 'approved' | 'denied' | 'inactive' | 'uncertain';
};

/** A pending snapshot can withdraw authority, but never erase an observed request. */
export function reconcileNativeApprovals(
  previous: readonly NativeApprovalReview[],
  pending: readonly ConversationApproval[],
): NativeApprovalReview[] {
  const latest = new Map(pending.map((row) => [approvalKey(row.target), row]));
  const result = previous.map((row): NativeApprovalReview => {
    const key = approvalKey(row.target);
    const present = latest.get(key);
    latest.delete(key);
    if (row.state === 'approved' || row.state === 'denied' || row.state === 'uncertain') return row;
    return present ? { ...present, state: 'pending' } : { ...row, state: 'inactive' };
  });
  return [...result, ...[...latest.values()].map((row) => ({ ...row, state: 'pending' as const }))];
}
