// Protocol adaptation of Hermes's use-voice-live-conversation.ts. See UPSTREAM.md.
import type { BridgeEvent } from '@hermes-client/protocol';
import type { LiveTranscriptFragment } from './live-session';
import { record } from './decode';

export function delegationPrompt(fragments: LiveTranscriptFragment[]) {
  const turns: { speaker: 'assistant' | 'user'; text: string }[] = [];
  for (const fragment of fragments) {
    const last = turns.at(-1);
    if (last?.speaker === fragment.speaker) last.text += fragment.text;
    else turns.push({ speaker: fragment.speaker, text: fragment.text });
  }
  return {
    text: (turns.findLast((turn) => turn.speaker === 'user')?.text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(-6000),
    context: turns
      .map((turn) => `${turn.speaker === 'user' ? 'User' : 'Voice assistant'}: ${turn.text}`)
      .join('\n')
      .slice(-6000),
  };
}
export type Completion =
  { user: number; kind: 'reply'; assistant: number } | { user: number; kind: 'failed' };
export function completion(event: BridgeEvent): Completion | undefined {
  if (event.type !== 'message.complete') return;
  const raw = event.payload?.persisted_turn;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const data = record(raw);
  if (
    typeof data.user_row_id !== 'number' ||
    !Number.isSafeInteger(data.user_row_id) ||
    data.user_row_id < 1
  )
    return;
  if (event.payload?.status === 'error') return { user: data.user_row_id, kind: 'failed' };
  return typeof data.final_assistant_row_id === 'number' &&
    Number.isSafeInteger(data.final_assistant_row_id) &&
    data.final_assistant_row_id > 0
    ? { user: data.user_row_id, kind: 'reply', assistant: data.final_assistant_row_id }
    : undefined;
}
/** Only an acknowledged native row can claim a completion, including early events. */
export class DelegationReceipts {
  private active: { id: string; user: number } | undefined;
  private early: Completion[] = [];
  accept(id: string, response: unknown): Completion | undefined {
    const data = record(response);
    if (
      typeof data.user_row_id !== 'number' ||
      !Number.isSafeInteger(data.user_row_id) ||
      data.user_row_id < 1
    )
      throw new Error(
        'Hermes queued this request. Its reply will stay in chat; voice will not guess which reply to read.',
      );
    this.active = { id, user: data.user_row_id };
    return this.early.find((item) => item.user === data.user_row_id);
  }
  observe(event: BridgeEvent): Completion | undefined {
    const result = completion(event);
    if (!result) return;
    this.early = [...this.early.slice(-15), result];
    return this.active?.user === result.user ? result : undefined;
  }
  take(result: Completion): string | undefined {
    if (this.active?.user !== result.user) return;
    const id = this.active.id;
    this.active = undefined;
    this.early = this.early.filter((item) => item.user !== result.user);
    return id;
  }
}
