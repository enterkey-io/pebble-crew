import type { ConversationMessage } from '@hermes-client/protocol';
export {
  decodeNativeMessages as nativeMessages,
  decodeRoomMessages as roomMessages,
} from '@hermes-client/protocol';
export type Row = Record<string, unknown>;
export type ChatMessage = ConversationMessage;
export function messageDate(value?: string | number): Date | undefined {
  if (value == null) return;
  const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export function withSharedFiles(
  messages: ChatMessage[],
  files: { id: string; name: string; size: number }[],
): ChatMessage[] {
  if (!files.length) return messages;
  return messages.map((message) => {
    if (message.role !== 'user') return message;
    const attached: typeof files = [];
    const text = message.text
      .replace(/@(?:file|image):(?:`[^`]+`|"[^"]+"|'[^']+'|\S+)/g, (ref) => {
        const file = files.find((f) => ref.includes(f.id + '_'));
        if (!file) return ref;
        if (!attached.some((f) => f.id === file.id)) attached.push(file);
        return '';
      })
      .trim();
    return attached.length
      ? {
          ...message,
          text: text === 'Please review the attached files.' ? '' : text,
          files: attached,
        }
      : message;
  });
}
