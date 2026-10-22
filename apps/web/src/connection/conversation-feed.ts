import { safeError } from '@hermes-client/core';
import { ConversationDomain } from '@hermes-client/protocol';
import type { BotConversation, BridgeEvent, SessionClient } from '@hermes-client/protocol';

type Target = {
  profile: string;
  sessionId: string;
  identity: object;
  generation: number;
  mutation: number;
  pending: boolean;
  bound?: boolean;
};
type Options = {
  client: Pick<SessionClient, 'invoke' | 'supportsConnectionRecovery'>;
  target: () => Target | undefined;
  receive: (event: BridgeEvent) => Promise<void>;
  apply: (snapshot: BotConversation, identity: object) => void;
};

/** Owns the recovery read and event barrier; the existing projection owns visible rows. */
export class ConversationFeed {
  #flight: Promise<boolean> | undefined;
  #buffer: BridgeEvent[] | undefined;
  #overflow = false;
  #dirty = new Set<string>();
  #closed = false;
  #bindingLost = false;
  #covered: { identity: object; revision: number } | undefined;
  constructor(private readonly options: Options) {}

  cover(identity: object, revision: number) {
    this.#covered = { identity, revision };
  }
  close() {
    this.#closed = true;
    this.#buffer = undefined;
  }
  async event(event: BridgeEvent) {
    if (this.#closed) return;
    if (this.#buffer && /^(message\.|tool\.|status\.|approval\.|error$)/.test(event.type)) {
      if (event.type === 'message.reaction' || event.type === 'approval.request')
        this.#dirty.add(event.session_id ?? '');
      else if (this.#buffer.length < 4096) this.#buffer.push(event);
      else this.#overflow = true;
      return;
    }
    await this.options.receive(event);
  }
  recover(leaseChanged: boolean, revision = 0): Promise<boolean> {
    if (this.#flight) return this.#flight;
    const flight = this.#recover(leaseChanged, revision);
    this.#flight = flight;
    return flight.finally(() => {
      if (this.#flight === flight) this.#flight = undefined;
    });
  }
  async #recover(leaseChanged: boolean, revision: number) {
    const target = this.options.target();
    if (!target || this.#closed) return true;
    if (this.#covered?.identity === target.identity && this.#covered.revision >= revision)
      return true;
    if (target.pending) return false;
    this.#buffer = [];
    this.#dirty.clear();
    this.#overflow = false;
    try {
      const domain = new ConversationDomain(this.options.client);
      const snapshot =
        (leaseChanged && !target.bound) ||
        this.#bindingLost ||
        !this.options.client.supportsConnectionRecovery
          ? await domain.open(target.profile)
          : await domain.snapshot(target.sessionId);
      const current = this.options.target();
      if (this.#closed) return true;
      if (
        !current ||
        current.identity !== target.identity ||
        current.generation !== target.generation
      )
        return false;
      if (
        current.pending ||
        current.mutation !== target.mutation ||
        this.#overflow ||
        this.#dirty.has(snapshot.sessionId)
      )
        return false;
      this.options.apply(snapshot, target.identity);
      this.#bindingLost = false;
      this.cover(this.options.target()?.identity ?? target.identity, revision);
      return true;
    } catch (error) {
      if (safeError(error).code !== 'CONVERSATION_CHANGED') throw error;
      this.#bindingLost = true;
      return false;
    } finally {
      const buffered = this.#buffer ?? [];
      this.#buffer = undefined;
      if (!this.#closed) for (const event of buffered) await this.options.receive(event);
    }
  }
}
