import {
  ClientError,
  ConnectionLifetime,
  endpointUrl,
  operationRoute,
  safeError,
  voiceErrors,
} from '@hermes-client/core';
import type { Endpoint } from '@hermes-client/core';
import { readBoundedJson, record } from './json';

export interface BridgeEvent {
  readonly type: string;
  readonly session_id?: string;
  readonly seq?: number;
  readonly stream_position?: unknown;
  readonly payload?: Readonly<Record<string, unknown>>;
}
export type DownloadedMedia = { blob: Blob; name: string };

/** Direct connection to an optional plugin on the user's Hermes host. */
export class BotBridgeClient {
  readonly #endpoint: Endpoint;
  readonly #fetch: typeof fetch;
  readonly #lifetime = new ConnectionLifetime();
  readonly #active = new Set<AbortController>();
  #token: string;
  #retired = false;
  #connection = '';
  #existingAgents = false;
  #workspace = false;
  #reporting = false;
  #projects = false;
  #attachments = false;
  #generatedMedia = false;
  #computer = false;
  #liveVoice = false;
  #secrets = false;
  #questions = false;
  #reactions = false;
  #roomReactions = false;
  #exchanges = false;
  #exchangeEvents = false;
  #recovery = false;
  #rpcActive = 0;
  readonly #rpcWaiting: (() => void)[] = [];

  get supportsConnectionRecovery(): boolean {
    return this.#recovery;
  }

  get supportsExchangeEvents(): boolean {
    return this.#exchangeEvents;
  }

  get supportsExchanges(): boolean {
    return this.#exchanges;
  }

  get supportsLiveVoice(): boolean {
    return this.#liveVoice;
  }
  get supportsProjects(): boolean {
    return this.#projects;
  }
  get supportsSecrets(): boolean {
    return this.#secrets;
  }
  get supportsQuestions(): boolean {
    return this.#questions;
  }
  get supportsComputer(): boolean {
    return this.#computer;
  }
  get supportsReactions(): boolean {
    return this.#reactions;
  }
  get supportsRoomReactions(): boolean {
    return this.#roomReactions;
  }
  computerSocket(ticket: string): WebSocket {
    if (
      this.#retired ||
      !this.#connection ||
      !this.#computer ||
      !/^[A-Za-z0-9_-]{43}$/.test(ticket)
    )
      throw new ClientError('UNSUPPORTED');
    const url = endpointUrl(this.#endpoint, 'v1/computer/stream');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    return new WebSocket(url);
  }
  get supportsAttachments(): boolean {
    return this.#attachments;
  }
  get supportsGeneratedMedia(): boolean {
    return this.#generatedMedia;
  }

  get supportsWorkspace(): boolean {
    return this.#workspace;
  }

  get supportsExistingAgents(): boolean {
    return this.#existingAgents;
  }

  constructor(endpoint: Endpoint, token: string, fetcher = fetch) {
    if (
      !/^(?:[A-Za-z0-9_-]{43,128}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(token) ||
      token.length > 4096
    )
      throw new ClientError('INVALID_CREDENTIAL');
    this.#endpoint = endpoint;
    this.#token = token;
    // Native browser fetch requires its global receiver, never the client object.
    this.#fetch = (input, init) => fetcher(input, init);
  }

  async connect(): Promise<void> {
    const data = record(await this.#request('v1/connect', 'POST'));
    if (
      data.protocol !== 'hermes-bot-web.v1' ||
      typeof data.connection !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(data.connection)
    )
      throw new ClientError('UNSUPPORTED');
    const existingAgents =
      !!data.capabilities && record(data.capabilities).existing_agents === true;
    this.#connection = data.connection;
    this.#recovery = !!data.capabilities && record(data.capabilities).connection_recovery === 1;
    this.#exchanges = !!data.capabilities && record(data.capabilities).exchanges === true;
    this.#exchangeEvents =
      !!data.capabilities && record(data.capabilities).exchange_events === true;
    this.#existingAgents = existingAgents;
    this.#reporting = !!data.capabilities && record(data.capabilities).reporting === 1;
    this.#projects = !!data.capabilities && record(data.capabilities).projects === true;
    this.#workspace = !!data.capabilities && record(data.capabilities).workspace === true;
    this.#attachments = !!data.capabilities && record(data.capabilities).attachments === true;
    this.#generatedMedia =
      !!data.capabilities && record(data.capabilities).generated_media === true;
    this.#computer = !!data.capabilities && record(data.capabilities).computer === true;
    this.#liveVoice = !!data.capabilities && record(data.capabilities).live_voice === true;
    this.#secrets = !!data.capabilities && record(data.capabilities).secrets === true;
    this.#questions = !!data.capabilities && record(data.capabilities).questions === true;
    this.#reactions = !!data.capabilities && record(data.capabilities).reactions === true;
    this.#roomReactions = !!data.capabilities && record(data.capabilities).room_reactions === true;
  }

  async invoke(operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (!this.#connection) throw new ClientError('DISCONNECTED');
    const generation = this.#lifetime.capture();
    const payload =
      this.#reporting &&
      [
        'bots.profile.update',
        'agent.onboard',
        'roles.update',
        'agent.create',
        'workspace.initialize',
        'workspace.set_orchestrator',
      ].includes(operation)
        ? { ...params, reporting_version: 1 }
        : params;
    return this.#withSlot(async () => {
      this.#lifetime.assertCurrent(generation);
      return record(
        await this.#request(operationRoute(operation), 'POST', { operation, params: payload }),
      ).result;
    });
  }

  async #withSlot<T>(task: () => Promise<T>): Promise<T> {
    // Uploads, downloads and RPC share three slots; the fourth is reserved for renewal.
    // Queued work is never a retry of an already dispatched mutation.
    if (this.#rpcWaiting.length >= 64) throw new ClientError('RPC_FAILED');
    if (this.#rpcActive >= 3) await new Promise<void>((done) => this.#rpcWaiting.push(done));
    else this.#rpcActive++;
    try {
      if (this.#retired) throw new ClientError('DISCONNECTED', undefined, 'not-dispatched');
      return await task();
    } finally {
      const next = this.#rpcWaiting.shift();
      if (next)
        next(); // Transfer this reserved slot to the next caller.
      else this.#rpcActive--;
    }
  }

  async renew(token: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 4096)
      throw new ClientError('INVALID_CREDENTIAL');
    await this.#request('v1/renew', 'POST', undefined, undefined, token);
    this.#token = token;
  }

  async health(): Promise<'responsive' | 'unavailable' | 'unconfirmed'> {
    if (!this.#recovery) {
      await this.invoke('bots.list', {});
      return 'responsive';
    }
    const value = record(await this.#request('v1/status', 'GET'));
    if (
      value.native !== 'responsive' &&
      value.native !== 'unavailable' &&
      value.native !== 'unconfirmed'
    )
      throw new ClientError('INVALID_RESPONSE');
    return value.native;
  }

  async uploadFile(sessionId: string, file: File, signal?: AbortSignal) {
    const generation = this.#lifetime.capture();
    return this.#withSlot(() => {
      this.#lifetime.assertCurrent(generation);
      signal?.throwIfAborted();
      return this.#uploadFile(sessionId, file, signal);
    });
  }
  async #uploadFile(
    sessionId: string,
    file: File,
    signal?: AbortSignal,
  ): Promise<{ id: string; name: string; size: number; kind: string; state: string }> {
    if (!this.#connection || !this.#attachments) throw new ClientError('UNSUPPORTED');
    if (!file.size || file.size > 10 * 1024 * 1024) throw new ClientError('INVALID_ATTACHMENT');
    const generation = this.#lifetime.capture();
    const bytes = new Uint8Array(await file.arrayBuffer());
    this.#lifetime.assertCurrent(generation);
    signal?.throwIfAborted();
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const result = record(
      record(
        await this.#request(
          'v1/files/upload',
          'POST',
          {
            operation: 'files.upload',
            params: { session_id: sessionId, name: file.name, data: btoa(binary) },
          },
          signal,
        ),
      ).result,
    );
    if (
      typeof result.id !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(result.id) ||
      typeof result.name !== 'string' ||
      typeof result.size !== 'number'
    )
      throw new ClientError('INVALID_RESPONSE');
    return result as { id: string; name: string; size: number; kind: string; state: string };
  }
  async downloadFile(sessionId: string, id: string): Promise<Blob> {
    const generation = this.#lifetime.capture();
    return this.#withSlot(() => {
      this.#lifetime.assertCurrent(generation);
      return this.#downloadBinary('files.read', { session_id: sessionId, id }).then(
        (file) => file.blob,
      );
    });
  }
  async downloadMedia(
    sessionId: string,
    rowId: number,
    reference: string,
    signal?: AbortSignal,
  ): Promise<DownloadedMedia> {
    if (!this.#generatedMedia) throw new ClientError('UNSUPPORTED');
    const generation = this.#lifetime.capture();
    return this.#withSlot(() => {
      this.#lifetime.assertCurrent(generation);
      signal?.throwIfAborted();
      return this.#downloadBinary(
        'media.read',
        { session_id: sessionId, row_id: rowId, reference },
        signal,
      );
    });
  }
  async #downloadBinary(
    operation: 'files.read' | 'media.read',
    params: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<DownloadedMedia> {
    if (!this.#connection) throw new ClientError('DISCONNECTED');
    const generation = this.#lifetime.capture(),
      controller = new AbortController();
    this.#active.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 50000);
    try {
      const url = endpointUrl(this.#endpoint, 'v1/files/read');
      const response = await this.#fetch(
        url,
        this.#options(controller, 'POST', {
          operation,
          params,
        }),
      );
      await this.#check(response, url);
      this.#lifetime.assertCurrent(generation);
      if (Number(response.headers.get('content-length')) > 10 * 1024 * 1024 || !response.body)
        throw new ClientError('INVALID_RESPONSE');
      const reader = response.body.getReader(),
        parts: Uint8Array<ArrayBuffer>[] = [];
      let bytes = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          bytes += item.value.length;
          if (bytes > 10 * 1024 * 1024) throw new ClientError('INVALID_RESPONSE');
          parts.push(new Uint8Array(item.value));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      this.#lifetime.assertCurrent(generation);
      if (
        Number(response.headers.get('content-length')) > 0 &&
        Number(response.headers.get('content-length')) !== bytes
      )
        throw new ClientError('INVALID_RESPONSE');
      const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
      const disposition = response.headers.get('content-disposition') ?? '';
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const name = encoded ? decodeURIComponent(encoded) : 'download';
      if (
        !name ||
        [...name].length > 180 ||
        /[/\\]/.test(name) ||
        [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw new ClientError('INVALID_RESPONSE');
      return {
        blob: new Blob(parts, {
          type: ['image/png', 'image/jpeg', 'image/webp', 'video/mp4'].includes(mime)
            ? mime
            : 'application/octet-stream',
        }),
        name,
      };
    } catch (e) {
      this.#lifetime.assertCurrent(generation);
      throw safeError(e);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      this.#active.delete(controller);
    }
  }
  async #request(
    route: string,
    method: 'POST' | 'DELETE' | 'GET',
    body?: unknown,
    signal?: AbortSignal,
    token?: string,
  ): Promise<unknown> {
    const generation = this.#lifetime.capture();
    if (this.#retired) throw new ClientError('DISCONNECTED', undefined, 'not-dispatched');
    const controller = new AbortController();
    this.#active.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 50_000);
    try {
      const url = endpointUrl(this.#endpoint, route);
      const response = await this.#fetch(url, this.#options(controller, method, body, token));
      this.#lifetime.assertCurrent(generation);
      await this.#check(response, url);
      const data = await readBoundedJson(response, 4 * 1024 * 1024);
      this.#lifetime.assertCurrent(generation);
      return data;
    } catch (error) {
      this.#lifetime.assertCurrent(generation);
      throw safeError(error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      this.#active.delete(controller);
    }
  }

  #options(
    controller: AbortController,
    method: string,
    body?: unknown,
    token = this.#token,
  ): RequestInit {
    return {
      method,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Bot-Connection': this.#connection,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
  }

  async #check(response: Response, url: URL): Promise<void> {
    if (
      !response.ok &&
      [400, 409, 422, 429, 502, 503].includes(response.status) &&
      (!response.url || response.url === url.href)
    ) {
      let code: unknown;
      try {
        code = record(await readBoundedJson(response, 4096)).code;
      } catch {
        /* Untrusted diagnostics never enter user-visible errors. */
      }
      const known = [
        'CONVERSATION_CHANGED',
        'LEASE_GONE',
        'STREAM_ACTIVE',
        'NATIVE_UNAVAILABLE',
        'CAPACITY',
        'UPDATE_REQUIRED',
        'UNSUPPORTED_COMMAND',
        'STALE_REVISION',
        'HANDLE_TAKEN',
        'INVALID_REPORTING',
        'MODEL_UNAVAILABLE',
        'REQUIRES_SETUP',
        'INVALID_PHOTO',
        'INVALID_PARAMETERS',
        'INVALID_ATTACHMENT',
        'ATTACHMENT_QUOTA',
      ] as const;
      const match =
        known.find((item) => item === code) ??
        Object.keys(voiceErrors).find((item): item is keyof typeof voiceErrors => item === code);
      const retry = Number(response.headers.get('Retry-After'));
      throw new ClientError(
        match ?? 'RPC_FAILED',
        {
          status: response.status,
          retryAfterMs: Number.isFinite(retry) ? Math.max(0, Math.min(300_000, retry * 1000)) : 0,
        },
        match === 'LEASE_GONE' || match === 'NATIVE_UNAVAILABLE' ? 'not-dispatched' : 'unknown',
      );
    }
    if (!response.ok || (response.url && response.url !== url.href)) {
      void response.body?.cancel();
      throw new ClientError(
        response.status === 401 || response.status === 403 ? 'UNAUTHORIZED' : 'RPC_FAILED',
        undefined,
        response.status === 401 || response.status === 403 ? 'not-dispatched' : 'unknown',
      );
    }
  }

  async events(onEvent: (event: BridgeEvent) => void, signal?: AbortSignal): Promise<void> {
    if (!this.#connection) throw new ClientError('DISCONNECTED');
    const generation = this.#lifetime.capture();
    const controller = new AbortController();
    this.#active.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let idle = setTimeout(abort, 35_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const url = endpointUrl(this.#endpoint, 'v1/events');
      const response = await this.#fetch(url, this.#options(controller, 'GET'));
      await this.#check(response, url);
      if (
        !response.body ||
        response.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/x-ndjson'
      )
        throw new ClientError('INVALID_RESPONSE');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '';
      let ready = false;
      while (true) {
        const chunk = await reader.read();
        this.#lifetime.assertCurrent(generation);
        if (chunk.done) break;
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), 35_000);
        pending += decoder.decode(chunk.value, { stream: true });
        if (pending.length > 4 * 1024 * 1024) throw new ClientError('RESPONSE_TOO_LARGE');
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line) continue;
          const raw = record(JSON.parse(line));
          if (typeof raw.type !== 'string') throw new ClientError('INVALID_RESPONSE');
          if (!ready && raw.type !== 'bridge.ready') throw new ClientError('INVALID_RESPONSE');
          if (ready && raw.type === 'bridge.ready') throw new ClientError('INVALID_RESPONSE');
          ready = true;
          onEvent(raw as unknown as BridgeEvent);
        }
      }
      throw new ClientError('DISCONNECTED');
    } catch (error) {
      this.#lifetime.assertCurrent(generation);
      if (controller.signal.aborted) throw new ClientError('REQUEST_TIMEOUT');
      throw safeError(error);
    } finally {
      clearTimeout(idle);
      signal?.removeEventListener('abort', abort);
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      this.#active.delete(controller);
    }
  }

  /** Stop queued/new dispatch without cancelling an already dispatched mutation receipt. */
  retire(): void {
    this.#retired = true;
  }

  disconnect(): void {
    if (this.#connection) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      // Capture headers before erasing credentials; independent of cancelled chat requests.
      void this.#fetch(endpointUrl(this.#endpoint, 'v1/connect'), {
        ...this.#options(controller, 'DELETE'),
        keepalive: true,
      })
        .then((response) => response.body?.cancel())
        .catch(() => undefined)
        .finally(() => clearTimeout(timer));
    }
    this.#lifetime.close();
    this.#token = '';
    this.#connection = '';
    // Negotiated features describe the server, not the lifetime of this lease.
    for (const controller of this.#active) controller.abort();
    this.#active.clear();
  }
}
