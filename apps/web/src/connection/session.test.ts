import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerSession } from './session';

async function fixture(credential = 'header.synthetic.signature') {
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let leases = 0;
  let streamStatus = 200;
  let renewalStatus = 200;
  let native: 'responsive' | 'unavailable' = 'responsive';
  const held = new Map<string, (response: Response) => void>();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/v1/connect' && init?.method === 'POST')
      return Response.json({
        protocol: 'hermes-bot-web.v1',
        connection: String(++leases).padStart(43, 'c'),
        capabilities: { connection_recovery: 1, workspace: true, generated_media: true },
      });
    if (path === '/v1/status') return Response.json({ native, age_ms: 0 });
    if (path === '/v1/renew') return Response.json({ renewed: true }, { status: renewalStatus });
    if (path === '/v1/files/read')
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    if (path === '/v1/rpc') {
      const { operation } = JSON.parse(String(init?.body));
      return new Promise<Response>((resolve) => held.set(operation, resolve));
    }
    if (path === '/v1/events') {
      if (streamStatus === 400) {
        streamStatus = 200;
        return Response.json({ code: 'LEASE_GONE' }, { status: 400 });
      }
      if (streamStatus !== 200)
        return Response.json(
          { code: streamStatus === 400 ? 'LEASE_GONE' : 'NATIVE_UNAVAILABLE' },
          { status: streamStatus },
        );
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller);
            controller.enqueue(new TextEncoder().encode('{"type":"bridge.ready"}\n'));
            const heartbeat = setInterval(() => {
              try {
                controller.enqueue(new TextEncoder().encode('{"type":"bridge.heartbeat"}\n'));
              } catch {
                clearInterval(heartbeat);
              }
            }, 15_000);
            init?.signal?.addEventListener('abort', () => {
              clearInterval(heartbeat);
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            });
          },
        }),
        { headers: { 'content-type': 'application/x-ndjson' } },
      );
    }
    return Response.json({});
  });
  const ticket = vi.fn<
    (signal?: AbortSignal) => Promise<{ ticket: string; bridgeUrl: string; expiresIn: number }>
  >(async () => ({
    ticket: credential,
    bridgeUrl: 'https://hermes.example.test',
    expiresIn: 300,
  }));
  const session = new OwnerSession({ ticket, fetch: fetcher, random: () => 0.5 });
  const resource = vi.fn(async () => true);
  session.registerResource(resource);
  session.start();
  await vi.advanceTimersByTimeAsync(1);
  return {
    session,
    ticket,
    fetcher,
    streams,
    resource,
    held,
    leases: () => leases,
    streamStatus: (value: number) => {
      streamStatus = value;
    },
    native: (value: 'responsive' | 'unavailable') => {
      native = value;
    },
    renewalStatus: (value: number) => {
      renewalStatus = value;
    },
    reply: (operation: string, value: unknown) =>
      held.get(operation)?.(Response.json({ result: value })),
    eventCalls: () =>
      fetcher.mock.calls.filter(([input]) => String(input).endsWith('/v1/events')).length,
  };
}
const sessions: OwnerSession[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
  vi.useRealTimers();
});
async function start(credential?: string) {
  vi.useFakeTimers();
  const h = await fixture(credential);
  sessions.push(h.session);
  return h;
}

describe('OwnerSession lifecycle', () => {
  it('preserves feature cancellation through the stable media port', async () => {
    const h = await start();
    const controller = new AbortController();
    const pending = h.session.client.downloadMedia(
      'native',
      1,
      'synthetic-image',
      controller.signal,
    );
    const failed = expect(pending).rejects.toBeDefined();
    controller.abort();
    await failed;
    const request = h.fetcher.mock.calls.find(([input]) =>
      String(input).endsWith('/v1/files/read'),
    );
    expect(request?.[1]?.signal?.aborted).toBe(true);
  });
  it('keeps its stable port and pending send across stream-only recovery', async () => {
    const h = await start();
    const port = h.session.client;
    const send = port.invoke('chat.send', { session_id: 'native', text: 'exactly once' });
    h.streams[0]!.close();
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.leases()).toBe(1);
    expect(h.session.client).toBe(port);
    h.reply('chat.send', { accepted: true });
    await expect(send).resolves.toEqual({ accepted: true });
    expect(h.resource).toHaveBeenCalledWith(false, expect.any(Number));
  });
  it('unblocks native requests after affirmative health recovery without replacing its lease', async () => {
    const h = await start();
    h.native('unavailable');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.session.getSnapshot()).toEqual({ kind: 'unavailable', reason: 'native' });
    await expect(h.session.client.invoke('workspace.describe', {})).rejects.toMatchObject({
      code: 'NATIVE_UNAVAILABLE',
    });
    h.resource.mockImplementation(async () => {
      const read = h.session.client.invoke('workspace.describe', {});
      h.reply('workspace.describe', { current: true });
      await read;
      return true;
    });
    h.native('responsive');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.session.getSnapshot()).toMatchObject({ kind: 'available', updates: 'live' });
    expect(h.leases()).toBe(1);
  });
  it('keeps opaque paired grants usable without trying to renew them as JWTs', async () => {
    const h = await start('p'.repeat(43));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(h.ticket).toHaveBeenCalledTimes(1);
    expect(h.fetcher.mock.calls.some(([input]) => String(input).endsWith('/v1/renew'))).toBe(false);
    expect(h.leases()).toBe(1);
  });
  it('bounds and cancels a hung ticket source while stream recovery remains independent', async () => {
    const h = await start();
    let signal: AbortSignal | undefined;
    h.ticket.mockImplementationOnce(async (...args) => {
      signal = args[0];
      return new Promise<never>(() => {});
    });
    await vi.advanceTimersByTimeAsync(240_000);
    h.streams.at(-1)!.close();
    const before = h.eventCalls();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.eventCalls()).toBeGreaterThan(before);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5001);
    expect(signal?.aborted).toBe(true);
    expect(h.leases()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(h.ticket).toHaveBeenCalledTimes(3);
  });
  it('does not hold subscription retries behind a slow recovery read', async () => {
    const h = await start();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.resource.mockImplementationOnce(async () => {
      await held;
      return true;
    });
    h.session.retry();
    await vi.advanceTimersByTimeAsync(1);
    h.streams.at(-1)!.close();
    const before = h.eventCalls();
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.eventCalls()).toBeGreaterThan(before);
    expect(h.leases()).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.session.getSnapshot()).toMatchObject({ kind: 'available', updates: 'live' });
  });
  it('identifies authority failure before dispatch so a draft can be retried safely', async () => {
    const h = await start();
    h.ticket.mockRejectedValue(new Error('private authority failure'));
    await vi.advanceTimersByTimeAsync(291_000);
    await expect(
      h.session.client.invoke('chat.send', { session_id: 'native', text: 'not sent' }),
    ).rejects.toMatchObject({ delivery: 'not-dispatched' });
    expect(h.held.has('chat.send')).toBe(false);
  });
  it('does not announce a superseded recovery pass as synchronized', async () => {
    const h = await start();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finish = () => {};
    const current = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let reads = 0;
    h.resource.mockImplementation(async () => {
      await (++reads === 1 ? held : current);
      return true;
    });
    const notices: string[] = [];
    h.session.subscribe((notice) => {
      if (notice.kind === 'recovery') notices.push(notice.kind);
    });
    h.session.retry();
    await vi.advanceTimersByTimeAsync(0);
    h.streams[0]!.close();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toHaveLength(0);
    expect(h.session.getSnapshot()).toMatchObject({ updates: 'recovering' });
    finish();
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.session.getSnapshot()).toMatchObject({ updates: 'live' });
  });
  it('backs off short-lived streams without churning leases', async () => {
    const h = await start();
    for (const [index, delay] of [1000, 2000, 4000].entries()) {
      h.streams[index]!.close();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.eventCalls()).toBe(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.eventCalls()).toBe(index + 2);
    }
    expect(h.leases()).toBe(1);
  });
  it('does not replace a valid lease after a temporary ticket failure', async () => {
    const h = await start();
    h.ticket.mockRejectedValueOnce(new Error('DO_NOT_RECORD_THE_PRIVATE_SOURCE'));
    await vi.advanceTimersByTimeAsync(240_000);
    expect(h.leases()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(h.ticket).toHaveBeenCalledTimes(3);
    expect(h.leases()).toBe(1);
    expect(JSON.stringify(h.session.diagnostics())).not.toContain('DO_NOT_RECORD');
    expect(JSON.stringify(h.session.diagnostics())).not.toContain('signature');
  });
  it('retains a dispatched mutation receipt while replacing only a proven lost lease', async () => {
    const h = await start();
    const port = h.session.client;
    const pending = port.invoke('chat.send', { session_id: 'native', text: 'never replay' });
    h.streamStatus(400);
    h.streams[0]!.close();
    await vi.advanceTimersByTimeAsync(2001);
    h.streamStatus(200);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.leases()).toBe(2);
    h.reply('chat.send', { accepted: true });
    await expect(pending).resolves.toEqual({ accepted: true });
    expect(
      h.fetcher.mock.calls.filter(
        ([input, init]) =>
          String(input).endsWith('/v1/rpc') &&
          JSON.parse(String(init?.body)).operation === 'chat.send',
      ),
    ).toHaveLength(1);
    expect(h.session.client).toBe(port);
  });
  it('rejects a late read from an older lease without discarding newer state', async () => {
    const h = await start();
    const pending = h.session.client.invoke('workspace.describe', {});
    const result = expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    h.streamStatus(400);
    h.streams[0]!.close();
    await vi.advanceTimersByTimeAsync(2001);
    h.streamStatus(200);
    await vi.advanceTimersByTimeAsync(1);
    h.reply('workspace.describe', { outdated: true });
    await result;
  });
  it('does not mark the feed live until its recovery snapshot has settled', async () => {
    const h = await start();
    h.resource.mockResolvedValue(false);
    h.streams[0]!.close();
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.session.getSnapshot()).toMatchObject({ kind: 'available', updates: 'recovering' });
    h.resource.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.session.getSnapshot()).toMatchObject({ kind: 'available', updates: 'live' });
  });
  it('coalesces wakeups and keeps diagnostics bounded and content-free', async () => {
    const h = await start();
    for (let index = 0; index < 100; index++) h.session.retry();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.leases()).toBe(1);
    expect(h.session.diagnostics().length).toBeLessThanOrEqual(64);
    const text = JSON.stringify(h.session.diagnostics());
    expect(text).not.toMatch(/hermes\.example|synthetic|signature|native-session/);
    h.session.close();
    await vi.advanceTimersByTimeAsync(500_000);
    expect(h.leases()).toBe(1);
    expect(h.session.getSnapshot()).toEqual({ kind: 'closed' });
  });
});
