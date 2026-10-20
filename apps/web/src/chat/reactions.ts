export {
  decodeMessageReactions as messageReactions,
  decodeReactionReceipt as reactionReceipt,
} from '@hermes-client/protocol';
export type { MessageReaction } from '@hermes-client/protocol';
import type {
  RoomReactionState,
  ConversationMessage,
  MessageReaction,
} from '@hermes-client/protocol';

export class RoomReactionProjection {
  private key = '';
  private revision = -1;
  private updates = new Map<string, MessageReaction[]>();
  accept(state: RoomReactionState) {
    if (state.key !== this.key) {
      this.key = state.key;
      this.revision = -1;
      this.updates.clear();
    }
    if (state.revision < this.revision) return;
    this.revision = state.revision;
    for (const update of state.updates) this.updates.set(update.id, update.reactions);
  }
  project(messages: ConversationMessage[]) {
    return messages.map((m) =>
      m.id && this.updates.has(m.id) ? { ...m, reactions: this.updates.get(m.id)! } : m,
    );
  }
}

export const reactionChoices = [
  { emoji: '👍', label: 'Thumbs up' },
  { emoji: '❤️', label: 'Heart' },
  { emoji: '😂', label: 'Laugh' },
  { emoji: '🎉', label: 'Celebrate' },
  { emoji: '😮', label: 'Surprised' },
  { emoji: '😢', label: 'Sad' },
  { emoji: '👀', label: 'Eyes' },
  { emoji: '🙏', label: 'Thank you' },
] as const;
