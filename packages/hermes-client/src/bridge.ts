import {
  ClientError,
  ConnectionLifetime,
  endpointUrl,
  operationRoute,
  safeError,
} from '@hermes-client/core';
import type { Endpoint } from '@hermes-client/core';
import { readBoundedJson, record } from './json';

export interface BridgeEvent {
  readonly type: string;
  readonly session_id?: string;
  readonly seq?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** Direct connection to an optional plugin on the user's Hermes host. */
export class BotBridgeClient {
  readonly #endpoint: Endpoint;
  readonly #fetch: typeof fetch;
  readonly #lifetime = new ConnectionLifetime();
  readonly #active = new Set<AbortController>();
  #token: string;
  #connection = '';
  #existingAgents = false;
  #workspace = false;
  #attachments = false;
  #computer = false;
  #reactions = false;
  #rpcActive = 0;
  readonly #rpcWaiting: (() => void)[] = [];

  get supportsComputer(): boolean {
    return this.#computer;
  }
  get supportsReactions(): boolean {
    return this.#reactions;
  }
  computerSocket(ticket: string): WebSocket {
    if (!this.#connection || !this.#computer || !/^[A-Za-z0-9_-]{43}$/.test(ticket))
      throw new ClientError('UNSUPPORTED');
    const url = endpointUrl(this.#endpoint, 'v1/computer/stream');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    return new WebSocket(url);
  }
  get supportsAttachments(): boolean {
    return this.#attachments;
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
    this.#existingAgents = existingAgents;
    this.#workspace = !!data.capabilities && record(data.capabilities).workspace === true;
    this.#attachments = !!data.capabilities && record(data.capabilities).attachments === true;
    this.#computer = !!data.capabilities && record(data.capabilities).computer === true;
    this.#reactions = !!data.capabilities && record(data.capabilities).reactions === true;
  }

  async invoke(operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (!this.#connection) throw new ClientError('DISCONNECTED');
    const generation = this.#lifetime.capture();
    return this.#withSlot(async () => {
      this.#lifetime.assertCurrent(generation);
      return record(await this.#request(operationRoute(operation), 'POST', { operation, params }))
        .result;
    });
  }

  async #withSlot<T>(task: () => Promise<T>): Promise<T> {
    // Uploads, downloads and RPC share three slots; the fourth is reserved for renewal.
    // Queued work is never a retry of an already dispatched mutation.
    if (this.#rpcWaiting.length >= 64) throw new ClientError('RPC_FAILED');
    if (this.#rpcActive >= 3) await new Promise<void>((done) => this.#rpcWaiting.push(done));
    else this.#rpcActive++;
    try {
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
    this.#token = token;
    await this.#request('v1/renew', 'POST');
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
      return this.#downloadFile(sessionId, id);
    });
  }
  async #downloadFile(sessionId: string, id: string): Promise<Blob> {
    if (!this.#connection) throw new ClientError('DISCONNECTED');
    const generation = this.#lifetime.capture(),
      controller = new AbortController();
    this.#active.add(controller);
    const timer = setTimeout(() => controller.abort(), 50000);
    try {
      const url = endpointUrl(this.#endpoint, 'v1/files/read');
      const response = await this.#fetch(
        url,
        this.#options(controller, 'POST', {
          operation: 'files.read',
          params: { session_id: sessionId, id },
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
      return new Blob(parts, { type: 'application/octet-stream' });
    } catch (e) {
      this.#lifetime.assertCurrent(generation);
      throw safeError(e);
    } finally {
      clearTimeout(timer);
      this.#active.delete(controller);
    }
  }
  async #request(
    route: string,
    method: 'POST' | 'DELETE',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const generation = this.#lifetime.capture();
    const controller = new AbortController();
    this.#active.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 50_000);
    try {
      const url = endpointUrl(this.#endpoint, route);
      const response = await this.#fetch(url, this.#options(controller, method, body));
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

  #options(controller: AbortController, method: string, body?: unknown): RequestInit {
    return {
      method,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        'X-Bot-Connection': this.#connection,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
  }

  async #check(response: Response, url: URL): Promise<void> {
    if (
      !response.ok &&
      [400, 409, 422].includes(response.status) &&
      (!response.url || response.url === url.href)
    ) {
      let code: unknown;
      try {
        code = record(await readBoundedJson(response, 4096)).code;
      } catch {
        /* Untrusted diagnostics never enter user-visible errors. */
      }
      const known = [
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
      const match = known.find((item) => item === code);
      throw new ClientError(match ?? 'RPC_FAILED');
    }
    if (!response.ok || (response.url && response.url !== url.href)) {
      void response.body?.cancel();
      throw new ClientError(
        response.status === 401 || response.status === 403 ? 'UNAUTHORIZED' : 'RPC_FAILED',
      );
    }
  }

  async events(onEvent: (event: BridgeEvent) => void): Promise<void> {
    if (!this.#connection) throw new ClientError('DISCONNECTED');
    const generation = this.#lifetime.capture();
    const controller = new AbortController();
    this.#active.add(controller);
    let idle = setTimeout(() => controller.abort(), 35_000);
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
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      this.#active.delete(controller);
    }
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
    this.#existingAgents = false;
    this.#attachments = false;
    this.#computer = false;
    this.#workspace = false;
    for (const controller of this.#active) controller.abort();
    this.#active.clear();
  }
}
