import { ClientError } from '@hermes-client/core';
import type { BotBridgeClient } from './bridge';
import { record } from './json';

export type CommandSuggestion = { text: string; label: string; description: string };
export type MessageReaction = { emoji: string; author: 'user' | 'agent' };
export type ConversationMessage = {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  id?: string | undefined;
  renderKey?: string | undefined;
  author?: string | undefined;
  timestamp?: string | number | undefined;
  files?: { id: string; name: string; size: number }[];
  toolName?: string;
  context?: string;
  commentary?: string[];
  reactions?: MessageReaction[];
};
export type HistoryCoverage = { readonly count: number; readonly maxRow: number };
export type ConversationHistory = {
  readonly messages: ConversationMessage[];
  readonly coverage: HistoryCoverage;
};
function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? record(value)
    : undefined;
}
function boundedText(value: unknown, limit = 1000000): string {
  if (typeof value !== 'string') return '';
  if (value.length > limit) throw new ClientError('RESPONSE_TOO_LARGE');
  return value;
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10000) throw new ClientError('INVALID_RESPONSE');
  return value;
}
function identity(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && value.length > 0 && value.length <= 512) return value;
  return undefined;
}
function timestamp(value: unknown): string | number | undefined {
  return typeof value === 'string'
    ? boundedText(value, 128)
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
}
function finalReply(value: unknown): string {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(boundedText(value));
    } catch {
      return '';
    }
  }
  if (!Array.isArray(value) || value.length > 10000) return '';
  const text: string[] = [];
  for (const item of value) {
    const message = optionalRecord(item);
    if (
      !message ||
      message.type !== 'message' ||
      message.role !== 'assistant' ||
      ['analysis', 'commentary'].includes(String(message.phase ?? '').toLowerCase()) ||
      !Array.isArray(message.content)
    )
      continue;
    for (const part of message.content) {
      const content = optionalRecord(part);
      if (
        content &&
        ['output_text', 'text'].includes(String(content.type)) &&
        typeof content.text === 'string'
      )
        text.push(boundedText(content.text));
    }
  }
  return boundedText(text.join(''));
}
export function decodeMessageReactions(value: unknown): MessageReaction[] {
  if (!Array.isArray(value)) return [];
  const authors = new Map<MessageReaction['author'], MessageReaction>();
  for (const item of value.slice(0, 100)) {
    const entry = optionalRecord(item);
    if (
      entry &&
      typeof entry.emoji === 'string' &&
      entry.emoji.length > 0 &&
      entry.emoji.length <= 64 &&
      (entry.author === 'user' || entry.author === 'agent')
    )
      authors.set(entry.author, { emoji: entry.emoji, author: entry.author });
  }
  return [...authors.values()];
}
export function decodeReactionReceipt(value: unknown): {
  id: string;
  reactions: MessageReaction[];
} {
  const data = record(value);
  if (
    typeof data.row_id !== 'number' ||
    !Number.isSafeInteger(data.row_id) ||
    data.row_id <= 0 ||
    !Array.isArray(data.reactions)
  )
    throw new ClientError('INVALID_RESPONSE');
  return { id: String(data.row_id), reactions: decodeMessageReactions(data.reactions) };
}
/** Hidden model analysis and arbitrary source records stop here. */
export function decodeNativeMessages(value: unknown): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const item of rows(value)) {
    const data = optionalRecord(item);
    if (!data || (data.role !== 'user' && data.role !== 'assistant' && data.role !== 'tool'))
      continue;
    const metadata = optionalRecord(data.display_metadata);
    messages.push({
      role: data.role,
      text:
        typeof data.text === 'string' && data.text.trim()
          ? boundedText(data.text)
          : data.role === 'assistant'
            ? finalReply(data.codex_message_items)
            : '',
      id: identity(data.row_id),
      timestamp: timestamp(data.timestamp),
      reactions: decodeMessageReactions(metadata?.reactions),
      ...(data.role === 'tool'
        ? {
            toolName: boundedText(data.name ?? data.tool_name, 512) || 'Tool',
            context: typeof data.context === 'string' ? data.context.slice(0, 1000) : '',
          }
        : {}),
      ...(Array.isArray(data.display_commentary)
        ? {
            commentary: data.display_commentary
              .slice(0, 1000)
              .flatMap((value) => (typeof value === 'string' ? [boundedText(value)] : [])),
          }
        : {}),
    });
  }
  return messages;
}
export function decodeHistory(value: unknown): ConversationHistory {
  const source = rows(record(value).messages);
  let maxRow = 0;
  for (const item of source) {
    const row = optionalRecord(item);
    if (
      row &&
      typeof row.row_id === 'number' &&
      Number.isSafeInteger(row.row_id) &&
      row.row_id > maxRow
    )
      maxRow = row.row_id;
  }
  return { messages: decodeNativeMessages(source), coverage: { count: source.length, maxRow } };
}
export function decodeRoomMessages(value: unknown): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const item of rows(value)) {
    const event = optionalRecord(item);
    if (!event || (event.kind !== 'message.user' && event.kind !== 'message.member')) continue;
    const payload = optionalRecord(event.payload);
    if (!payload || typeof payload.text !== 'string') continue;
    const actor = optionalRecord(event.actor);
    const author =
      typeof event.actor === 'string'
        ? event.actor
        : typeof actor?.profile === 'string'
          ? actor.profile
          : typeof actor?.id === 'string'
            ? actor.id
            : undefined;
    messages.push({
      role: event.kind === 'message.user' ? 'user' : 'assistant',
      text: boundedText(payload.text),
      id: identity(event.event_id ?? event.seq),
      author: author ? boundedText(author, 512) : undefined,
      timestamp: timestamp(event.created_at),
    });
  }
  return messages;
}
export type ApprovalTarget =
  | { kind: 'chat'; sessionId: string; requestId: string }
  | {
      kind: 'room';
      roomId: string;
      memberId: string;
      taskId: string;
      executionGeneration: number;
      requestId: string;
    };
export type ConversationApproval = {
  readonly target: ApprovalTarget;
  readonly description: string;
};
export function decodeApprovals(
  value: unknown,
  scope: { kind: 'chat'; sessionId: string } | { kind: 'room'; roomId: string },
): ConversationApproval[] {
  return rows(value).map((item) => {
    const data = record(item);
    const requestId = identity(data.request_id);
    if (!requestId) throw new ClientError('INVALID_RESPONSE');
    const details = optionalRecord(data.approval);
    const description =
      boundedText(data.command ?? data.description ?? details?.command, 16000) ||
      'Hermes requested permission.';
    if (scope.kind === 'chat')
      return { target: { kind: 'chat', sessionId: scope.sessionId, requestId }, description };
    const memberId = identity(data.member_id),
      taskId = identity(data.task_id);
    if (
      !memberId ||
      !taskId ||
      typeof data.execution_generation !== 'number' ||
      !Number.isSafeInteger(data.execution_generation) ||
      data.execution_generation < 0
    )
      throw new ClientError('INVALID_RESPONSE');
    return {
      target: {
        kind: 'room',
        roomId: scope.roomId,
        memberId,
        taskId,
        executionGeneration: data.execution_generation,
        requestId,
      },
      description,
    };
  });
}
export class ConversationDomain {
  constructor(private readonly bridge: Pick<BotBridgeClient, 'invoke'>) {}
  async send(edit: ChatSend): Promise<{ accepted: boolean; userRowId: string | undefined }> {
    const value = record(
      await this.bridge.invoke('chat.send', {
        session_id: edit.sessionId,
        text: edit.text,
        ...(edit.attachments
          ? { attachments: edit.attachments.ids, request_id: edit.attachments.requestId }
          : {}),
      }),
    );
    return { accepted: value.state === 'accepted', userRowId: identity(value.user_row_id) };
  }
  async sendRoom(edit: { roomId: string; eventId: string; text: string }): Promise<void> {
    await this.bridge.invoke('room.send', {
      room_id: edit.roomId,
      event_id: edit.eventId,
      text: edit.text,
    });
  }
  stop(target: ConversationTarget) {
    return this.bridge.invoke(
      target.kind === 'chat' ? 'chat.stop' : 'room.stop',
      target.kind === 'chat' ? { session_id: target.sessionId } : { room_id: target.roomId },
    );
  }
  async files(sessionId: string): Promise<SharedConversationFile[]> {
    return decodeSharedFiles(await this.bridge.invoke('files.list', { session_id: sessionId }));
  }
  async commands(
    sessionId: string,
    text: string,
  ): Promise<{ items: CommandSuggestion[]; replaceFrom: number }> {
    const data = record(await this.bridge.invoke('chat.commands', { session_id: sessionId, text }));
    if (
      !Array.isArray(data.items) ||
      !Number.isSafeInteger(data.replace_from) ||
      typeof data.replace_from !== 'number' ||
      data.replace_from < 0 ||
      data.replace_from > text.length ||
      data.items.length > 100
    )
      throw new ClientError('INVALID_RESPONSE');
    const items = data.items.map((raw) => {
      const item = record(raw);
      if (
        typeof item.text !== 'string' ||
        typeof item.label !== 'string' ||
        typeof item.description !== 'string' ||
        item.text.length > 250 ||
        item.label.length > 250 ||
        item.description.length > 300
      )
        throw new ClientError('INVALID_RESPONSE');
      return { text: item.text, label: item.label, description: item.description };
    });
    return { items, replaceFrom: data.replace_from };
  }
  async command(sessionId: string, text: string): Promise<string> {
    const data = record(await this.bridge.invoke('chat.command', { session_id: sessionId, text }));
    if (typeof data.output !== 'string' || data.output.length > 64000)
      throw new ClientError('INVALID_RESPONSE');
    return data.output;
  }
  async open(profile: string): Promise<BotConversation> {
    return decodeBotConversation(await this.bridge.invoke('bot.open', { profile }));
  }
  async history(sessionId: string): Promise<ConversationHistory> {
    return decodeHistory(await this.bridge.invoke('chat.history', { session_id: sessionId }));
  }
  async approvals(sessionId: string): Promise<ConversationApproval[]> {
    return decodeApprovals(
      record(await this.bridge.invoke('chat.approvals', { session_id: sessionId })).approvals,
      { kind: 'chat', sessionId },
    );
  }
  async react(sessionId: string, rowId: number, emoji: string | null) {
    if (!Number.isSafeInteger(rowId) || rowId <= 0) throw new ClientError('INVALID_RESPONSE');
    return decodeReactionReceipt(
      await this.bridge.invoke('chat.react', { session_id: sessionId, row_id: rowId, emoji }),
    );
  }
  decide(target: ApprovalTarget, choice: 'once' | 'deny') {
    return target.kind === 'chat'
      ? this.bridge.invoke('chat.approve', {
          session_id: target.sessionId,
          request_id: target.requestId,
          choice,
        })
      : this.bridge.invoke('room.approve', {
          room_id: target.roomId,
          member_id: target.memberId,
          task_id: target.taskId,
          execution_generation: target.executionGeneration,
          request_id: target.requestId,
          choice,
        });
  }
}

export type BotConversation = {
  readonly sessionId: string;
  readonly history: ConversationHistory;
  readonly running: boolean;
  readonly inflight: string;
};
export function decodeBotConversation(value: unknown): BotConversation {
  const data = record(value);
  const sessionId = identity(data.session_id);
  if (!sessionId) throw new ClientError('INVALID_RESPONSE');
  const inflight = optionalRecord(data.inflight);
  return {
    sessionId,
    history: decodeHistory(data),
    running: data.running === true,
    inflight: boundedText(inflight?.assistant),
  };
}
export function approvalKey(target: ApprovalTarget): string {
  return JSON.stringify(
    target.kind === 'chat'
      ? ['chat', target.sessionId, target.requestId]
      : [
          'room',
          target.roomId,
          target.memberId,
          target.taskId,
          target.executionGeneration,
          target.requestId,
        ],
  );
}

export type SharedConversationFile = {
  id: string;
  name: string;
  kind: string;
  size: number;
  state: string;
  created?: number;
};
export function decodeSharedFiles(value: unknown): SharedConversationFile[] {
  const data = record(value);
  return rows(data.files).map((item) => {
    const file = record(item);
    if (
      typeof file.id !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(file.id) ||
      typeof file.name !== 'string' ||
      !file.name ||
      file.name.length > 255 ||
      typeof file.kind !== 'string' ||
      file.kind.length > 64 ||
      typeof file.state !== 'string' ||
      file.state.length > 64 ||
      typeof file.size !== 'number' ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    )
      throw new ClientError('INVALID_RESPONSE');
    return {
      id: file.id,
      name: file.name,
      kind: file.kind,
      size: file.size,
      state: file.state,
      ...(typeof file.created === 'number' && Number.isFinite(file.created)
        ? { created: file.created }
        : {}),
    };
  });
}

export type ChatSend = {
  sessionId: string;
  text: string;
  attachments?: { ids: readonly [string, ...string[]]; requestId: string };
};
export type ConversationTarget =
  { kind: 'chat'; sessionId: string } | { kind: 'room'; roomId: string };
