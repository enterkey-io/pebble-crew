import type { ConversationMessage, StreamHandoff, VoiceCallRecord } from '@hermes-client/protocol';
import type { SendProjection } from './send-projection';
import type { WorkProgress } from './activity';

export type ConversationView = {
  profile: string;
  sessionId: string;
  messages: ConversationMessage[];
  stream: string;
  running: boolean;
  activity: string;
  older: string | null | undefined;
  projection: SendProjection;
  handoff: StreamHandoff;
  progress: WorkProgress;
  binding: { connection: object; epoch: number };
  calls: readonly VoiceCallRecord[];
  read: { key: string; cursor: number } | undefined;
  blocked: boolean;
  attachmentUncertain: boolean;
};

/** Inactive views only. No mounted trees, media blobs or persistent browser storage. */
export class ConversationMemory {
  private entries = new Map<string, { view: ConversationView; bytes: number }>();
  private bytes = 0;
  private scope = '';
  constructor(
    private readonly limit = 6 * 1024 * 1024,
    private readonly count = 8,
  ) {}
  bind(scope: string) {
    if (scope !== this.scope) {
      this.clear();
      this.scope = scope;
    }
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
  take(key: string, profile: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    return entry.view.profile === profile ? entry.view : undefined;
  }
  remember(key: string, view: ConversationView) {
    this.take(key, view.profile);
    let bytes = view.stream.length * 2;
    for (const row of view.messages) {
      bytes += 384 + row.text.length * 2 + (row.context?.length ?? 0) * 2;
      for (const text of row.commentary ?? []) bytes += text.length * 2;
      if (bytes > this.limit) return;
    }
    if (bytes > this.limit) return;
    this.entries.set(key, { view, bytes });
    this.bytes += bytes;
    while (this.bytes > this.limit || this.entries.size > this.count) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const entry = this.entries.get(oldest.value);
      if (entry) this.bytes -= entry.bytes;
      this.entries.delete(oldest.value);
    }
  }
}
