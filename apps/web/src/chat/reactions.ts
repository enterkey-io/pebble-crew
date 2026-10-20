export {
  decodeMessageReactions as messageReactions,
  decodeReactionReceipt as reactionReceipt,
} from '@hermes-client/protocol';
export type { MessageReaction } from '@hermes-client/protocol';

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
