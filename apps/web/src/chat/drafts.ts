const prefix = 'pebblecrew.draft.v2.';
const legacyPrefix = 'pebblecrew.draft.v1.';
type Draft = { key: string; text: string; updatedAt: number; raw: string };

function removeSavedDrafts(scope: string) {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) if (key?.startsWith(scope)) localStorage.removeItem(key);
  } catch {
    // Storage restrictions must not prevent typing or signing out.
  }
}

export function clearSavedDrafts() {
  removeSavedDrafts(prefix);
  removeSavedDrafts(legacyPrefix);
}

/** Each edit owns an immutable storage key; a late receipt cannot delete another tab's draft. */
export class ConversationDrafts {
  private scope = '';
  private values = new Map<string, Draft>();

  bind(workspaceId: string | undefined) {
    if (!workspaceId) return;
    const next = `${prefix}${encodeURIComponent(workspaceId)}:`;
    if (next === this.scope) return;
    this.scope = next;
    this.values.clear();
  }

  private get legacyScope() {
    return legacyPrefix + this.scope.slice(prefix.length, -1) + '.';
  }

  private read(conversation: string): Draft | undefined {
    const memory = this.values.get(conversation);
    if (memory || !this.scope) return memory;
    const base = this.scope + encodeURIComponent(conversation) + ':';
    let latest: Draft | undefined;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(base)) continue;
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        try {
          const value: unknown = JSON.parse(raw);
          if (
            !value ||
            typeof value !== 'object' ||
            !('text' in value) ||
            typeof value.text !== 'string' ||
            !('updatedAt' in value) ||
            typeof value.updatedAt !== 'number' ||
            !Number.isFinite(value.updatedAt)
          )
            continue;
          const record = { key, raw, text: value.text, updatedAt: value.updatedAt };
          if (
            !latest ||
            record.updatedAt > latest.updatedAt ||
            (record.updatedAt === latest.updatedAt && record.key > latest.key)
          )
            latest = record;
        } catch {
          /* Ignore an incomplete cache entry, retaining other drafts. */
        }
      }
      if (!latest) {
        const key = this.legacyScope + encodeURIComponent(conversation);
        const text = localStorage.getItem(key);
        if (text !== null) latest = { key, text, raw: text, updatedAt: 0 };
      }
    } catch {
      /* The in-memory draft remains usable without browser storage. */
    }
    if (latest) this.values.set(conversation, latest);
    return latest;
  }

  get(conversation: string): string | undefined {
    return this.read(conversation)?.text || undefined;
  }

  private remove(record: Draft) {
    try {
      if (localStorage.getItem(record.key) === record.raw) localStorage.removeItem(record.key);
    } catch {
      /* Storage restrictions must not prevent sending or editing. */
    }
  }

  set(conversation: string, text: string) {
    const previous = this.read(conversation);
    const record: Draft = {
      key: this.scope + encodeURIComponent(conversation) + ':' + crypto.randomUUID(),
      text,
      updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1),
      raw: '',
    };
    record.raw = JSON.stringify({ text: record.text, updatedAt: record.updatedAt });
    this.values.set(conversation, record);
    if (!this.scope) return;
    try {
      localStorage.setItem(record.key, record.raw);
      if (previous) this.remove(previous);
    } catch {
      /* Retain the in-memory draft when browser storage is unavailable or full. */
    }
  }

  /** Confirmation also identifies an unchanged submission restored after navigation. */
  submission(conversation: string) {
    const scope = this.scope,
      record = this.read(conversation);
    return {
      confirm: () => {
        if (this.scope !== scope || this.values.get(conversation) !== record) return false;
        this.values.delete(conversation);
        if (record) this.remove(record);
        return true;
      },
    };
  }

  delete(conversation: string) {
    this.set(conversation, '');
  }

  clear() {
    this.values.clear();
    if (this.scope) {
      removeSavedDrafts(this.scope);
      removeSavedDrafts(this.legacyScope);
    }
  }
}
