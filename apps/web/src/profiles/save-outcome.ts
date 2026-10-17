import { ClientError, safeError } from '@hermes-client/core';
import type { WriteOutcome } from '@hermes-client/protocol';

export function profileWriteError(outcome: Exclude<WriteOutcome<unknown>, { kind: 'confirmed' }>) {
  return outcome.kind === 'refused'
    ? safeError(new ClientError(outcome.reason)).message
    : 'The save could not be confirmed. Reopen this profile to review it before saving again.';
}
