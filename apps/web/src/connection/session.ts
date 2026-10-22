import { ClientError, normalizeEndpoint, operationEffect, safeError } from '@hermes-client/core';
import { BotBridgeClient } from '@hermes-client/protocol';
import type { BridgeEvent, SessionClient } from '@hermes-client/protocol';

export type SessionStatus =
  | { kind: 'starting' }
  | { kind: 'available'; updates: 'live' | 'recovering' | 'polling'; recoveryRevision: number }
  | { kind: 'unavailable'; reason: 'network' | 'native' | 'capacity' }
  | { kind: 'sign-in-required' }
  | { kind: 'closed' };
export type SessionTicket = { ticket: string; bridgeUrl: string; expiresIn?: number };
export type SessionNotice =
  | { kind: 'status'; status: SessionStatus }
  | { kind: 'event'; event: BridgeEvent }
  | { kind: 'recovery'; leaseChanged: boolean };
type Diagnostic = {
  at: number;
  stage: 'ticket' | 'lease' | 'events' | 'native' | 'resources' | 'request';
  code: string;
  epoch: number;
  attempt: number;
};
type Resource = (leaseChanged: boolean, revision: number) => Promise<boolean>;

/** One owner for authority, lease, subscription and recovery deadlines. No chat state lives here. */
export class OwnerSession {
  readonly client: SessionClient;
  #wire: BotBridgeClient | undefined;
  #capabilities: BotBridgeClient | undefined;
  #epoch = 0;
  #closed = false;
  #started = false;
  #status: SessionStatus = { kind: 'starting' };
  #listeners = new Set<(notice: SessionNotice) => void>();
  #resources = new Set<Resource>();
  #records: Diagnostic[] = [];
  #active = new Map<BotBridgeClient, number>();
  #retired = new Set<BotBridgeClient>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #driving = false;
  #again = false;
  #stream: AbortController | undefined;
  #streamReady = false;
  #streamDue = 0;
  #streamAttempts = 0;
  #leaseAttempts = 0;
  #leaseDue = 0;
  #renewDue = Infinity;
  #expires = Infinity;
  #renewing: { wire: BotBridgeClient; promise: Promise<void> } | undefined;
  #healthDue = Infinity;
  #resourceDue = Infinity;
  #dirty = 0;
  #settled = 0;
  #leaseChanged = true;
  #restoring = false;
  #checking: BotBridgeClient | undefined;
  #tickets = new Set<AbortController>();
  #removeLifecycle = () => {};

  constructor(
    private readonly options: {
      ticket: (signal: AbortSignal) => Promise<SessionTicket>;
      fetch?: typeof fetch;
      localDev?: boolean;
      random?: () => number;
    },
  ) {
    const capabilities = () => this.#capabilities;
    this.client = {
      get supportsConnectionRecovery() {
        return capabilities()?.supportsConnectionRecovery ?? false;
      },
      get supportsExchangeEvents() {
        return capabilities()?.supportsExchangeEvents ?? false;
      },
      get supportsExchanges() {
        return capabilities()?.supportsExchanges ?? false;
      },
      get supportsLiveVoice() {
        return capabilities()?.supportsLiveVoice ?? false;
      },
      get supportsProjects() {
        return capabilities()?.supportsProjects ?? false;
      },
      get supportsSecrets() {
        return capabilities()?.supportsSecrets ?? false;
      },
      get supportsQuestions() {
        return capabilities()?.supportsQuestions ?? false;
      },
      get supportsComputer() {
        return capabilities()?.supportsComputer ?? false;
      },
      get supportsReactions() {
        return capabilities()?.supportsReactions ?? false;
      },
      get supportsRoomReactions() {
        return capabilities()?.supportsRoomReactions ?? false;
      },
      get supportsAttachments() {
        return capabilities()?.supportsAttachments ?? false;
      },
      get supportsGeneratedMedia() {
        return capabilities()?.supportsGeneratedMedia ?? false;
      },
      get supportsWorkspace() {
        return capabilities()?.supportsWorkspace ?? false;
      },
      get supportsExistingAgents() {
        return capabilities()?.supportsExistingAgents ?? false;
      },
      computerSocket: (ticket) => this.#transport().computerSocket(ticket),
      invoke: (operation, params) =>
        this.#request(
          (wire) => wire.invoke(operation, params),
          operationEffect(operation, params) !== 'write',
        ),
      uploadFile: (session, file, signal) =>
        this.#request((wire) => wire.uploadFile(session, file, signal), false),
      downloadFile: (session, id) => this.#request((wire) => wire.downloadFile(session, id), true),
      downloadMedia: (session, row, reference, signal) =>
        this.#request((wire) => wire.downloadMedia(session, row, reference, signal), true),
    };
  }
  get recoveryVersion() {
    return this.#dirty;
  }
  get bindingEpoch() {
    return this.#epoch;
  }
  getSnapshot() {
    return this.#status;
  }
  diagnostics() {
    return this.#records.map((record) => ({ ...record }));
  }
  subscribe(listener: (notice: SessionNotice) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  registerResource(resource: Resource) {
    this.#resources.add(resource);
    return () => {
      this.#resources.delete(resource);
    };
  }
  start() {
    if (this.#started || this.#closed) return;
    this.#started = true;
    if (typeof window !== 'undefined') {
      const wake = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        this.retry();
      };
      for (const event of ['online', 'offline', 'focus', 'pageshow'])
        window.addEventListener(event, wake);
      const hide = (event: PageTransitionEvent) => {
        if (!event.persisted) this.close();
      };
      window.addEventListener('pagehide', hide);
      document.addEventListener('visibilitychange', wake);
      this.#removeLifecycle = () => {
        for (const event of ['online', 'offline', 'focus', 'pageshow'])
          window.removeEventListener(event, wake);
        document.removeEventListener('visibilitychange', wake);
        window.removeEventListener('pagehide', hide);
      };
    }
    this.#schedule(0);
  }
  retry(delay = 0) {
    if (this.#closed) return;
    this.#leaseDue = this.#streamDue = this.#healthDue = performance.now() + delay;
    if (this.#expires - performance.now() < 60_000) this.#renewDue = performance.now();
    this.#invalidate(false);
    this.#resourceDue = performance.now() + delay;
    this.#schedule(delay);
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#epoch++;
    clearTimeout(this.#timer);
    this.#removeLifecycle();
    for (const controller of this.#tickets) controller.abort();
    this.#stream?.abort();
    this.#wire?.disconnect();
    this.#capabilities = undefined;
    for (const wire of this.#retired) wire.disconnect();
    this.#retired.clear();
    this.#resources.clear();
    this.#set({ kind: 'closed' });
    this.#listeners.clear();
    this.#records = [];
  }
  #transport() {
    if (this.#closed || !this.#wire) throw new ClientError('DISCONNECTED');
    return this.#wire;
  }
  #set(status: SessionStatus) {
    if (JSON.stringify(status) === JSON.stringify(this.#status)) return;
    this.#status = status;
    this.#emit({ kind: 'status', status });
  }
  #emit(notice: SessionNotice) {
    for (const listener of this.#listeners) listener(notice);
  }
  #record(stage: Diagnostic['stage'], code: string, attempt = 0) {
    this.#records.push({
      at: Math.round(performance.now()),
      stage,
      code,
      epoch: this.#epoch,
      attempt,
    });
    if (this.#records.length > 64) this.#records.shift();
  }
  #delay(attempt: number, minimum = 0) {
    return Math.max(
      minimum,
      Math.round(
        Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) *
          (0.85 + (this.options.random?.() ?? Math.random()) * 0.3),
      ),
    );
  }
  #schedule(delay: number) {
    if (this.#closed || !this.#started) return;
    if (this.#driving) {
      this.#again = true;
      return;
    }
    clearTimeout(this.#timer);
    this.#timer = setTimeout(
      () => {
        void this.#drive();
      },
      Math.max(0, delay),
    );
  }
  #invalidate(leaseChanged: boolean) {
    this.#dirty++;
    this.#leaseChanged ||= leaseChanged;
    this.#resourceDue = performance.now();
    if (this.#wire && this.#status.kind === 'available')
      this.#set({ ...this.#status, updates: 'recovering' });
  }
  async #request<T>(task: (wire: BotBridgeClient) => Promise<T>, read: boolean): Promise<T> {
    let wire: BotBridgeClient;
    try {
      wire = this.#transport();
      if (this.#expires - performance.now() < 10_000) await this.#renew();
      if (wire !== this.#wire) throw new ClientError('DISCONNECTED');
      if (this.#status.kind === 'unavailable' && this.#status.reason === 'native')
        throw new ClientError('NATIVE_UNAVAILABLE');
    } catch (error) {
      const failure = safeError(error);
      throw new ClientError(failure.code, failure.evidence, 'not-dispatched');
    }
    const epoch = this.#epoch;
    this.#active.set(wire, (this.#active.get(wire) ?? 0) + 1);
    try {
      const value = await task(wire);
      if (this.#closed || (read && epoch !== this.#epoch)) throw new ClientError('DISCONNECTED');
      return value;
    } catch (error) {
      if (!this.#closed && wire === this.#wire) this.#observe(safeError(error), 'request');
      throw error;
    } finally {
      const count = (this.#active.get(wire) ?? 1) - 1;
      this.#active.set(wire, count);
      if (!count && this.#retired.delete(wire)) {
        this.#active.delete(wire);
        wire.disconnect();
      }
    }
  }
  #observe(error: ClientError, stage: Diagnostic['stage']) {
    this.#record(stage, error.code);
    if (error.code === 'LEASE_GONE') this.#replace();
    else if (error.code === 'UNAUTHORIZED') this.#renewDue = performance.now();
    else if (error.code === 'NATIVE_UNAVAILABLE') {
      this.#set({ kind: 'unavailable', reason: 'native' });
      this.#healthDue = performance.now() + 2000;
    }
    this.#schedule(0);
  }
  #replace() {
    const old = this.#wire;
    if (!old) return;
    this.#epoch++;
    this.#wire = undefined;
    this.#stream?.abort();
    this.#stream = undefined;
    this.#streamReady = false;
    this.#renewDue = this.#healthDue = Infinity;
    this.#leaseDue = performance.now() + this.#delay(this.#leaseAttempts++);
    this.#leaseChanged = true;
    this.#set({ kind: 'unavailable', reason: 'network' });
    if (old) {
      old.retire();
      if (this.#active.get(old)) this.#retired.add(old);
      else old.disconnect();
    }
  }
  async #ticket() {
    const controller = new AbortController();
    this.#tickets.add(controller);
    let aborted = () => {};
    const deadline = new Promise<never>((_, reject) => {
      aborted = () => reject(new ClientError(this.#closed ? 'DISCONNECTED' : 'REQUEST_TIMEOUT'));
      controller.signal.addEventListener('abort', aborted, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      return await Promise.race([this.options.ticket(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', aborted);
      this.#tickets.delete(controller);
    }
  }
  async #renew() {
    const wire = this.#transport();
    if (this.#renewing?.wire === wire) return this.#renewing.promise;
    const flight = (async () => {
      const next = await this.#ticket();
      if (this.#closed || this.#wire !== wire) throw new ClientError('DISCONNECTED');
      await wire.renew(next.ticket);
      if (this.#wire === wire && !this.#closed) {
        this.#authority(next);
        this.#record('ticket', 'renewed');
      }
    })();
    this.#renewing = { wire, promise: flight };
    try {
      await flight;
    } finally {
      if (this.#renewing?.promise === flight) this.#renewing = undefined;
    }
  }
  #authority(ticket: SessionTicket) {
    // Paired browser grants have no renewable JWT expiry. Their lease still has idle expiry.
    this.#expires = ticket.ticket.includes('.')
      ? performance.now() + Math.max(1, Math.min(300, ticket.expiresIn ?? 300)) * 1000
      : Infinity;
    this.#renewDue = this.#expires - 60_000;
  }
  async #connect() {
    let candidate: BotBridgeClient | undefined;
    try {
      const next = await this.#ticket();
      if (this.#closed) return;
      candidate = new BotBridgeClient(
        normalizeEndpoint(next.bridgeUrl, this.options.localDev),
        next.ticket,
        this.options.fetch,
      );
      await candidate.connect();
      if (this.#closed) {
        candidate.disconnect();
        return;
      }
      this.#wire = candidate;
      this.#capabilities = candidate;
      this.#epoch++;
      this.#authority(next);
      this.#healthDue = performance.now() + 15_000;
      this.#streamDue = 0;
      this.#record('lease', 'connected');
      this.#set({ kind: 'available', updates: 'recovering', recoveryRevision: this.#dirty });
      this.#invalidate(true);
    } catch (error) {
      candidate?.disconnect();
      if (this.#closed) return;
      const failure = safeError(error);
      this.#record('lease', failure.code, this.#leaseAttempts);
      this.#set({
        kind: 'unavailable',
        reason: failure.code === 'CAPACITY' ? 'capacity' : 'network',
      });
      this.#leaseDue =
        performance.now() + this.#delay(this.#leaseAttempts++, failure.evidence?.retryAfterMs);
    }
  }
  #startStream(wire: BotBridgeClient) {
    const controller = new AbortController();
    this.#stream = controller;
    const started = performance.now();
    void wire
      .events((event) => {
        if (this.#closed || this.#wire !== wire || this.#stream !== controller) return;
        if (event.type === 'bridge.ready') {
          this.#streamReady = true;
          this.#record('events', 'ready');
          this.#invalidate(false);
          this.#schedule(0);
        } else if (event.type === 'bridge.heartbeat') {
          if (performance.now() - started >= 30_000) {
            this.#streamAttempts = 0;
            this.#leaseAttempts = 0;
          }
        } else if (event.type === 'bridge.resync') {
          this.#record('events', 'resync');
          controller.abort();
        } else this.#emit({ kind: 'event', event });
      }, controller.signal)
      .catch((error: unknown) => {
        if (this.#closed || this.#wire !== wire || this.#stream !== controller) return;
        this.#stream = undefined;
        this.#streamReady = false;
        const failure = safeError(error);
        this.#record('events', failure.code, this.#streamAttempts);
        if (!wire.supportsConnectionRecovery && failure.code === 'INVALID_PARAMETERS')
          this.#healthDue = performance.now();
        this.#observe(failure, 'events');
        this.#streamDue =
          performance.now() + this.#delay(this.#streamAttempts++, failure.evidence?.retryAfterMs);
        this.#invalidate(false);
        this.#schedule(0);
      });
  }
  async #restore() {
    if (this.#restoring || this.#dirty === this.#settled || !this.#wire) return;
    this.#restoring = true;
    this.#resourceDue = Infinity;
    const revision = this.#dirty,
      epoch = this.#epoch,
      leaseChanged = this.#leaseChanged;
    try {
      const results = await Promise.all(
        [...this.#resources].map((resource) => resource(leaseChanged, revision)),
      );
      if (results.some((result) => !result)) {
        this.#resourceDue = performance.now() + 1000;
        return;
      }
      if (this.#closed || epoch !== this.#epoch) return;
      if (this.#dirty !== revision) {
        this.#resourceDue = performance.now();
        return;
      }
      this.#settled = revision;
      this.#leaseChanged = false;
      this.#resourceDue =
        this.#dirty !== revision
          ? performance.now()
          : this.#streamReady
            ? Infinity
            : performance.now() + 5000;
      this.#set({
        kind: 'available',
        updates: this.#streamReady ? 'live' : 'polling',
        recoveryRevision: revision,
      });
      this.#emit({ kind: 'recovery', leaseChanged });
    } catch (error) {
      if (!this.#closed && epoch === this.#epoch) {
        this.#record('resources', safeError(error).code);
        this.#resourceDue = performance.now() + 2000;
      }
    } finally {
      this.#restoring = false;
      this.#schedule(0);
    }
  }
  async #checkHealth(wire: BotBridgeClient) {
    this.#checking = wire;
    try {
      try {
        const health = await wire.health();
        if (this.#closed || this.#wire !== wire) return;
        this.#record('native', health);
        if (health === 'unavailable') this.#set({ kind: 'unavailable', reason: 'native' });
        else if (health === 'responsive' && this.#status.kind === 'unavailable') {
          this.#set({
            kind: 'available',
            updates: 'recovering',
            recoveryRevision: this.#settled,
          });
          this.#invalidate(false);
        }
      } catch (error) {
        if (this.#closed || this.#wire !== wire) return;
        const failure = safeError(error);
        if (['REQUEST_FAILED', 'REQUEST_TIMEOUT', 'RPC_FAILED'].includes(failure.code))
          this.#set({ kind: 'unavailable', reason: 'network' });
        // Legacy bridges lack LEASE_GONE: only a known-valid, read-only probe can confirm it.
        if (!wire.supportsConnectionRecovery && failure.code === 'INVALID_PARAMETERS')
          this.#replace();
        else this.#observe(failure, 'native');
      }
    } finally {
      if (this.#checking === wire) this.#checking = undefined;
      if (this.#wire === wire)
        this.#healthDue = performance.now() + (this.#status.kind === 'unavailable' ? 5000 : 15_000);
      this.#schedule(0);
    }
  }
  async #drive() {
    if (this.#closed) return;
    this.#driving = true;
    this.#again = false;
    try {
      if (!this.#wire && performance.now() >= this.#leaseDue) await this.#connect();
      const wire = this.#wire;
      if (!wire || this.#closed) return;
      if (performance.now() >= this.#renewDue && this.#renewing?.wire !== wire) {
        void this.#renew()
          .catch((error: unknown) => {
            if (this.#closed || this.#wire !== wire) return;
            const failure = safeError(error);
            if (failure.code === 'LEASE_GONE') this.#replace();
            else {
              this.#record('ticket', failure.code);
              this.#renewDue = performance.now() + 10_000;
              if (performance.now() >= this.#expires)
                this.#set({ kind: 'unavailable', reason: 'network' });
            }
          })
          .finally(() => this.#schedule(0));
      }
      if (this.#wire !== wire || this.#closed) return;
      if (performance.now() >= this.#healthDue && this.#checking !== wire)
        void this.#checkHealth(wire);
      if (this.#wire !== wire || this.#closed) return;
      if (!this.#stream && performance.now() >= this.#streamDue) this.#startStream(wire);
      if (!this.#restoring && performance.now() >= this.#resourceDue) {
        if (this.#settled === this.#dirty) this.#dirty++;
        void this.#restore();
      }
    } finally {
      this.#driving = false;
      if (!this.#closed) {
        const now = performance.now();
        const deadline = this.#wire
          ? Math.min(
              this.#renewing?.wire === this.#wire ? Infinity : this.#renewDue,
              this.#checking === this.#wire ? Infinity : this.#healthDue,
              this.#restoring ? Infinity : this.#resourceDue,
              this.#stream ? Infinity : this.#streamDue,
            )
          : this.#leaseDue;
        if (this.#again || Number.isFinite(deadline))
          this.#schedule(this.#again ? 0 : Math.max(100, deadline - now));
      }
    }
  }
}
