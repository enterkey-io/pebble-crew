import type { ConversationMessage as ChatMessage } from '@hermes-client/protocol';

export type TimelineItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'activity'; id: string; messages: ChatMessage[] };
/** Presentation never controls native history coverage or read cursors. */
export function projectTimeline(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      const previous = items.at(-1);
      if (previous?.kind === 'activity' && previous.messages.at(-1)?.author === message.author)
        previous.messages.push(message);
      else
        items.push({
          kind: 'activity',
          id: message.id ?? `activity-${items.length}`,
          messages: [message],
        });
    } else if (message.text.trim() || message.files?.length)
      items.push({ kind: 'message', message });
    else if (message.commentary?.length) {
      const text = message.commentary.filter((p: unknown) => typeof p === 'string').join('\n');
      if (text.trim())
        items.push({
          kind: 'activity',
          id: message.id ?? `activity-${items.length}`,
          messages: [{ ...message, text }],
        });
    }
  }
  return items;
}
