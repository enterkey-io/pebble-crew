const prefix = 'pebblecrew.draft.v1.';

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
}

/** Unsent text stays in this browser, scoped to the native workspace and conversation identity. */
export class ConversationDrafts {
  private scope = '';
  private values = new Map<string, string>();
  private edits = new Map<string, symbol>();

  bind(workspaceId: string | undefined) {
    if (!workspaceId) return;
    const next = `${prefix}${encodeURIComponent(workspaceId)}.`;
    if (next === this.scope) return;
    this.scope = next;
    this.values.clear();
    this.edits.clear();
  }

  get(conversation: string): string | undefined {
    const memory = this.values.get(conversation);
    if (memory !== undefined || !this.scope) return memory;
    try {
      return localStorage.getItem(this.scope + encodeURIComponent(conversation)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  set(conversation: string, text: string) {
    if (!text) return this.delete(conversation);
    this.values.set(conversation, text);
    this.edits.set(conversation, Symbol());
    if (!this.scope) return;
    try {
      localStorage.setItem(this.scope + encodeURIComponent(conversation), text);
    } catch {
      // Retain the in-memory draft if browser storage is unavailable or full.
    }
  }

  /** A receipt clears only this submission, even after navigation or an identical later edit. */
  submission(conversation: string) {
    const scope = this.scope,
      edit = Symbol();
    this.edits.set(conversation, edit);
    return {
      confirm: () => {
        if (this.scope === scope && this.edits.get(conversation) === edit)
          this.delete(conversation);
      },
    };
  }

  delete(conversation: string) {
    this.values.delete(conversation);
    this.edits.delete(conversation);
    if (!this.scope) return;
    try {
      localStorage.removeItem(this.scope + encodeURIComponent(conversation));
    } catch {
      // The in-memory composer remains usable without storage access.
    }
  }

  clear() {
    this.values.clear();
    this.edits.clear();
    if (this.scope) removeSavedDrafts(this.scope);
  }
}
