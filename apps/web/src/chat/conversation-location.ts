type ConversationLocation = { kind: 'bot'; id: string } | { kind: 'room'; id: string };

export function conversationLocation(workspaceId: string): ConversationLocation | undefined {
  try {
    const raw = localStorage.getItem(`pebblecrew.conversation.${workspaceId}`);
    if (!raw || raw.length > 512) return;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('kind' in value) ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !value.id ||
      value.id.length > 128
    )
      return;
    if (value.kind === 'bot' || value.kind === 'room') return { kind: value.kind, id: value.id };
  } catch {
    /* Storage can be disabled in a private browsing context. */
  }
}

export function rememberConversation(workspaceId: string, value: ConversationLocation) {
  try {
    localStorage.setItem(`pebblecrew.conversation.${workspaceId}`, JSON.stringify(value));
  } catch {
    /* Opening a chat must not depend on storage access. */
  }
}
