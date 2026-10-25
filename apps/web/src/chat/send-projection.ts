import type { ChatMessage } from '../conversation';
import type { LiveCorrection } from '@hermes-client/protocol';

type LocalMessage = ChatMessage & { id: string; renderKey: string };
type Reply = { renderKey: string; timestamp: string };
type Pending = {
  message: LocalMessage;
  before: Set<string>;
  nativeId?: string;
  acknowledged?: boolean;
  completed?: boolean;
  deferred?: boolean;
};
type Cut = { message: LocalMessage; offset: number; after: Reply };

/** Correlates only native receipts; repeated message text is never an identity. */
export class SendProjection {
  private aliases = new Map<
    string,
    { renderKey: string; timestamp: string | number | undefined }
  >();
  reply = this.newReply();
  replying = false;
  private cuts: Cut[] = [];
  private tail = new Set<string>();
  private newReply() {
    return { renderKey: `reply-${crypto.randomUUID()}`, timestamp: new Date().toISOString() };
  }
  beginReply() {
    this.reply = this.newReply();
    this.replying = true;
    this.cuts = [];
    this.tail.clear();
    for (const pending of this.pending.values())
      if (pending.deferred) {
        pending.deferred = false;
        pending.completed = false;
        pending.before = new Set(
          this.latest.flatMap((message) => (message.id ? [message.id] : [])),
        );
      }
  }
  completeReply(nativeId: unknown) {
    // A redirected turn can contain several assistant/user boundaries. Its
    // final row does not address the entire stream that preceded the redirect.
    if (!this.cuts.length && (typeof nativeId === 'number' || typeof nativeId === 'string'))
      this.aliases.set(String(nativeId), this.reply);
  }
  private pending = new Map<string, Pending>();
  private latest: ChatMessage[] = [];
  begin(message: LocalMessage, existing: ChatMessage[], duringReply?: string) {
    this.latest = existing.filter((row) => !row.id || !this.pending.has(row.id));
    this.pending.set(message.id, {
      message,
      before: new Set(existing.flatMap((m) => (m.id ? [m.id] : []))),
    });
    if (duringReply !== undefined)
      this.cuts.push({ message, offset: duringReply.length, after: this.newReply() });
    return this.project(this.latest);
  }
  cancelUnsent(submissionId: string) {
    this.pending.delete(submissionId);
    this.cuts = this.cuts.filter((cut) => cut.message.id !== submissionId);
    this.tail.delete(submissionId);
    return this.project(this.latest);
  }
  acknowledge(nativeId: unknown, submissionId: string, deferred = false) {
    const pending = this.pending.get(submissionId);
    if (pending) pending.acknowledged = true;
    if (pending && (typeof nativeId === 'number' || typeof nativeId === 'string')) {
      const id = String(nativeId);
      pending.nativeId = id;
      this.aliases.set(id, {
        renderKey: pending.message.renderKey,
        timestamp: pending.message.timestamp,
      });
    }
    if (deferred) {
      if (pending) pending.deferred = true;
      this.cuts = this.cuts.filter((cut) => cut.message.id !== submissionId);
      this.tail.add(submissionId);
    }
    return this.project(this.latest);
  }
  project(incoming: ChatMessage[], complete = false): ChatMessage[] {
    if (complete) {
      this.replying = false;
      this.cuts = [];
      this.tail = new Set([...this.tail].filter((id) => this.pending.get(id)?.deferred));
    }
    this.latest = incoming;
    let rows = incoming;
    for (const [id, pending] of this.pending) {
      const found = pending.nativeId && incoming.some((m) => m.id === pending.nativeId);
      if (complete) pending.completed = true;
      if (
        found ||
        (pending.completed && pending.acknowledged && !pending.nativeId && !pending.deferred)
      )
        this.pending.delete(id);
      else {
        // A native history event may beat its acknowledgement. Defer newly seen
        // user rows until that receipt rather than displaying a duplicate or
        // guessing that identical text came from this browser.
        const addressed = new Set(
          [...this.pending.values()].flatMap((entry) => (entry.nativeId ? [entry.nativeId] : [])),
        );
        rows = rows.filter(
          (m) =>
            m.role !== 'user' ||
            (m.id && (pending.before.has(m.id) || addressed.has(m.id) || this.pending.has(m.id))),
        );
        const index = rows.findIndex((m) => m.id && !pending.before.has(m.id));
        rows = [...rows];
        rows.splice(index < 0 ? rows.length : index, 0, pending.message);
      }
    }
    for (const id of this.tail)
      if (
        !this.pending.has(id) &&
        !incoming.some(
          (row) =>
            (row.renderKey ??
              (row.id ? this.aliases.get(row.id)?.renderKey : undefined) ??
              row.id) === id,
        )
      )
        this.tail.delete(id);
    return rows.map((m) => {
      const alias = m.id ? this.aliases.get(m.id) : undefined;
      return alias
        ? { ...m, renderKey: alias.renderKey, timestamp: alias.timestamp ?? m.timestamp }
        : m;
    });
  }

  restore({
    history,
    corrections,
    inflight: assistant,
    activeUserId,
    liveAssistantIds,
    running,
    deferred = [],
  }: {
    history: { messages: ChatMessage[] };
    corrections: readonly LiveCorrection[];
    inflight: string;
    activeUserId: string | undefined;
    liveAssistantIds?: readonly string[] | undefined;
    running: boolean;
    deferred?: readonly { text: string; rowId: string | undefined }[];
  }) {
    this.replying = running;
    this.tail = new Set([...this.tail].filter((id) => this.pending.get(id)?.deferred));
    const waiting = deferred.map((prompt, index): LocalMessage => {
      const id = prompt.rowId ?? `native-waiting-${this.reply.renderKey}-${index}`;
      return {
        ...history.messages.find((row) => row.id === prompt.rowId),
        id,
        renderKey: this.aliases.get(id)?.renderKey ?? id,
        role: 'user',
        text: prompt.text,
      };
    });
    const nativeMessages = [
      ...history.messages.map((row) => waiting.find((prompt) => prompt.id === row.id) ?? row),
      ...waiting.filter((row) => !history.messages.some((saved) => saved.id === row.id)),
    ];
    if (!running) {
      // An offline completion is authoritative, including reaction-only turns.
      this.tail.clear();
      for (const [id, pending] of this.pending)
        if (pending.acknowledged && !pending.nativeId) this.pending.delete(id);
      return { messages: this.project(nativeMessages, true), stream: '' };
    }
    const anchor = activeUserId
      ? history.messages.findIndex(
          (message) => message.id === activeUserId && message.role === 'user',
        )
      : -1;
    if (anchor < 0) {
      if (liveAssistantIds !== undefined) this.cuts = [];
      // Without a native row anchor, keep stored history authoritative. Do not
      // subtract a same-text user row from a different turn to infer overlap.
      for (const row of waiting) this.tail.add(row.renderKey);
      if (waiting.length)
        for (const [id, pending] of this.pending)
          if (pending.acknowledged && pending.deferred && !pending.nativeId)
            this.pending.delete(id);
      return {
        messages: this.project(nativeMessages),
        stream: this.cuts.length || !corrections.length ? assistant : '',
      };
    }
    // Only an anchored snapshot replaces the live presentation as a unit.
    // Accepted native fallback sends are outside its correction span and stay.
    for (const [id, pending] of this.pending)
      if (pending.acknowledged && !pending.nativeId) this.pending.delete(id);
    const previous = this.cuts;
    this.replying = running;
    this.cuts = corrections.map((correction, index) => ({
      offset: correction.offset ?? assistant.length,
      message: {
        ...history.messages.find((message) => message.id === correction.rowId),
        role: 'user',
        id: correction.rowId ?? `live-correction-${this.reply.renderKey}-${index}`,
        renderKey: correction.rowId ?? `live-correction-${this.reply.renderKey}-${index}`,
        text: correction.text,
      },
      after: previous[index]?.after ?? this.newReply(),
    }));
    const covered = new Set(
      corrections.flatMap((correction) => (correction.rowId ? [correction.rowId] : [])),
    );
    const liveRows = new Set(liveAssistantIds ?? []);
    const later = nativeMessages
      .slice(anchor + 1)
      .filter(
        (message) =>
          !(message.role === 'assistant' && message.id && liveRows.has(message.id)) &&
          !(message.role === 'user' && covered.has(message.id ?? '')),
      );
    for (const row of waiting)
      if (row.id && !history.messages.slice(0, anchor + 1).some((saved) => saved.id === row.id))
        this.tail.add(row.renderKey);
    const base = [...history.messages.slice(0, anchor + 1), ...later];
    return { messages: this.project(base), stream: assistant };
  }

  display(messages: ChatMessage[], stream: string) {
    const cuts = this.cuts;
    const moved = new Set([...cuts.map((cut) => cut.message.renderKey), ...this.tail]);
    const rows = messages.filter((message) => !moved.has(message.renderKey ?? message.id ?? ''));
    const liveIds = new Set<string>();
    let start = 0;
    let reply = this.reply;
    const append = (end: number) => {
      const text = stream.slice(start, end);
      if (text) {
        liveIds.add(reply.renderKey);
        rows.push({ ...reply, id: reply.renderKey, role: 'assistant', text });
      }
      start = end;
    };
    for (const cut of cuts) {
      append(cut.offset);
      rows.push(
        messages.find((message) => message.renderKey === cut.message.renderKey) ?? cut.message,
      );
      reply = cut.after;
    }
    append(stream.length);
    for (const message of messages)
      if (this.tail.has(message.renderKey ?? message.id ?? '')) rows.push(message);
    return { messages: rows, liveIds };
  }
}
