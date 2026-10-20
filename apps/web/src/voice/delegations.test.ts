import { describe, expect, it } from 'vitest';
import { DelegationReceipts, delegationPrompt } from './delegations';
const completed = (user: number, assistant: number) => ({
  type: 'message.complete',
  payload: { persisted_turn: { user_row_id: user, final_assistant_row_id: assistant } },
});
describe('live voice attribution', () => {
  it('does not speak typed or other-device replies', () => {
    const receipts = new DelegationReceipts();
    receipts.accept('own-delegation', { user_row_id: 44 });
    expect(receipts.observe(completed(43, 45))).toBeUndefined();
    const result = receipts.observe(completed(44, 46));
    expect(result).toEqual({ user: 44, kind: 'reply', assistant: 46 });
    expect(receipts.take(result!)).toBe('own-delegation');
    expect(receipts.take(result!)).toBeUndefined();
  });
  it('retains a completion that arrives before the HTTP acceptance', () => {
    const receipts = new DelegationReceipts();
    receipts.observe(completed(44, 46));
    expect(receipts.accept('early', { user_row_id: 44 })).toEqual({
      user: 44,
      kind: 'reply',
      assistant: 46,
    });
  });
  it('settles a failed owned turn without borrowing an earlier assistant row', () => {
    const receipts = new DelegationReceipts();
    receipts.accept('failed', { user_row_id: 44 });
    const result = receipts.observe({
      type: 'message.complete',
      payload: { status: 'error', persisted_turn: { user_row_id: 44 } },
    });
    expect(result).toEqual({ user: 44, kind: 'failed' });
    expect(result && receipts.take(result)).toBe('failed');
  });
  it('never guesses a queued or ambiguous receipt', () => {
    expect(() => new DelegationReceipts().accept('queued', { status: 'queued' })).toThrow('queued');
    expect(() => new DelegationReceipts().accept('bad', { user_row_id: true })).toThrow();
  });
  it('keeps spoken context bounded and submits the latest utterance', () => {
    expect(
      delegationPrompt([
        { speaker: 'user', text: 'Check ', startMs: 0, endMs: 1 },
        { speaker: 'user', text: 'the file.', startMs: 1, endMs: 2 },
        { speaker: 'assistant', text: 'Which file?', startMs: 2, endMs: 3 },
        { speaker: 'user', text: 'The report.', startMs: 3, endMs: 4 },
      ]).text,
    ).toBe('The report.');
  });
});
