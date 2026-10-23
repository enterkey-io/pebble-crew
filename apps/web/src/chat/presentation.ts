import type { ConversationMessage as ChatMessage } from '@hermes-client/protocol';
import type { ReactNode } from 'react';
import { messageDate } from '../conversation';

export type TranscriptCard = {
  id: string;
  createdAt?: number | undefined;
  content: ReactNode;
  needsInput?: boolean;
};
type PositionedCard = { index: number; card: TranscriptCard };
type CardAnchor = { kind: 'before' | 'after'; key: string } | { kind: 'start' };
const messageKey = (message: ChatMessage) => message.renderKey ?? message.id;

/** Keep observed cards between the same native rows as replies stream and settle. */
export class CardPositions {
  private anchors = new Map<string, CardAnchor>();
  place(messages: ChatMessage[], cards: readonly TranscriptCard[]): PositionedCard[] {
    const indices = new Map<string, number>();
    for (const [index, message] of messages.entries()) {
      const key = messageKey(message);
      if (key) indices.set(key, index);
    }
    return [...cards]
      .sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity))
      .map((card) => {
        let anchor = this.anchors.get(card.id);
        if (anchor?.kind === 'before' || anchor?.kind === 'after') {
          const index = indices.get(anchor.key);
          if (index !== undefined)
            return { index: index + (anchor.kind === 'after' ? 1 : 0), card };
        } else if (anchor?.kind === 'start') return { index: 0, card };
        const createdAt = card.createdAt;
        const later =
          createdAt === undefined
            ? -1
            : messages.findIndex((message) => {
                const at = messageDate(message.timestamp)?.getTime();
                return at !== undefined && at > createdAt;
              });
        const index = later < 0 ? messages.length : later;
        const next = messages[index],
          previous = messages[index - 1];
        const before = next && messageKey(next),
          after = previous && messageKey(previous);
        anchor = after
          ? { kind: 'after', key: after }
          : before
            ? { kind: 'before', key: before }
            : { kind: 'start' };
        this.anchors.set(card.id, anchor);
        return { index, card };
      });
  }
}

export type TimelineItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'activity'; id: string; messages: ChatMessage[] }
  | { kind: 'card'; card: TranscriptCard };
/** Presentation never controls native history coverage or read cursors. */
export function projectTimeline(
  messages: ChatMessage[],
  cards: PositionedCard[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const slots = new Map<number, TranscriptCard[]>();
  for (const { index, card } of cards) {
    const slot = slots.get(index);
    if (slot) slot.push(card);
    else slots.set(index, [card]);
  }
  for (let index = 0; index <= messages.length; index++) {
    for (const card of slots.get(index) ?? []) items.push({ kind: 'card', card });
    const message = messages[index];
    if (!message) continue;
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
