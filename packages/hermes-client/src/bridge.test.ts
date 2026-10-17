import { describe, expect, it, vi } from 'vitest';
import { normalizeEndpoint } from '@hermes-client/core';
import { BotBridgeClient } from './bridge';

const token = 't'.repeat(43);
const connection = 'c'.repeat(43);
const endpoint = normalizeEndpoint('https://personal.example.test/bridge');
function connectedResponse() {
  return Response.json({ protocol: 'hermes-bot-web.v1', connection });
}

describe('direct Bot Mode bridge', () => {
  it('bounds concurrent RPC calls and cancels queued mutations on disconnect', async () => {
    const replies: ((r: Response) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
      if (String(input).endsWith('/v1/connect')) return connectedResponse();
      if (options?.method === 'POST') return new Promise<Response>((done) => replies.push(done));
      throw new Error('Unexpected test route');
    });
    const client = new BotBridgeClient(endpoint, token, fetcher);
    await client.connect();
    const calls = Array.from({ length: 4 }, (_, i) =>
      client.invoke('chat.send', { session_id: 'synthetic', text: String(i) }),
    );
    const settled = Promise.allSettled(calls);
    expect(replies).toHaveLength(3);
    client.disconnect();
    replies.forEach((done) => done(Response.json({ result: { accepted: true } })));
    expect(
      (await settled).every((r) => r.status === 'rejected' && r.reason.code === 'DISCONNECTED'),
    ).toBe(true);
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/v1/rpc'))).toHaveLength(
      3,
    );
  });
  it('shares the three-request budget between multi-file uploads and ordinary RPC', async () => {
    const pending: (() => void)[] = [];
    let active = 0,
      peak = 0,
      completed = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
      if (String(input).endsWith('/v1/connect'))
        return Response.json({
          protocol: 'hermes-bot-web.v1',
          connection,
          capabilities: { attachments: true },
        });
      active++;
      peak = Math.max(peak, active);
      const body = JSON.parse(String(options?.body));
      return new Promise<Response>((resolve) =>
        pending.push(() => {
          active--;
          completed++;
          resolve(
            Response.json({
              result:
                body.operation === 'files.upload'
                  ? {
                      id: 'f'.repeat(43),
                      name: body.params.name,
                      size: 4,
                      kind: 'file',
                      state: 'staged',
                    }
                  : { ok: true },
            }),
          );
        }),
      );
    });
    const client = new BotBridgeClient(endpoint, token, fetcher);
    await client.connect();
    const calls = [
      ...Array.from({ length: 5 }, (_, i) =>
        client.uploadFile('session', new File(['note'], `file-${i}.txt`)),
      ),
      client.invoke('workspace.describe', {}),
    ];
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    while (completed < 6) {
      pending.splice(0).forEach((done) => done());
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await Promise.all(calls);
    expect(peak).toBe(3);
    expect(completed).toBe(6);
  });
  it('renews an owner ticket without replacing its live connection or replaying a mutation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(connectedResponse())
      .mockResolvedValueOnce(Response.json({ renewed: true }));
    const client = new BotBridgeClient(endpoint, 'header.payload.signature', fetcher);
    await client.connect();
    await client.renew('header.next.signature');
    expect(String(fetcher.mock.calls[1]![0])).toBe('https://personal.example.test/bridge/v1/renew');
    expect(fetcher.mock.calls[1]![1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer header.next.signature', 'X-Bot-Connection': connection },
    });
    expect(fetcher.mock.calls).toHaveLength(2);
  });
  it('uses only allowlisted error codes and discards untrusted private diagnostics', async () => {
    for (const [code, expected] of [
      ['STALE_REVISION', 'STALE_REVISION'],
      ['PRIVATE_PROVIDER_ERROR', 'RPC_FAILED'],
    ]) {
      const client = new BotBridgeClient(
        endpoint,
        token,
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(connectedResponse())
          .mockResolvedValueOnce(
            Response.json({ code, error: `${token} personal.example.test` }, { status: 409 }),
          ),
      );
      await client.connect();
      await expect(client.invoke('roles.update', {})).rejects.toMatchObject({ code: expected });
    }
  });
  it('negotiates existing-agent support while retaining compatibility with older bridges', async () => {
    const old = new BotBridgeClient(
      endpoint,
      token,
      vi.fn<typeof fetch>().mockResolvedValue(connectedResponse()),
    );
    await old.connect();
    expect(old.supportsExistingAgents).toBe(false);
    const current = new BotBridgeClient(
      endpoint,
      token,
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          protocol: 'hermes-bot-web.v1',
          connection,
          capabilities: { existing_agents: true },
        }),
      ),
    );
    await current.connect();
    expect(current.supportsExistingAgents).toBe(true);
    current.disconnect();
    expect(current.supportsExistingAgents).toBe(false);
  });
  it('keeps credentials in headers, refuses redirects/cookies and preserves endpoint prefix', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(connectedResponse())
      .mockResolvedValueOnce(Response.json({ result: { bots: [] } }));
    const client = new BotBridgeClient(endpoint, token, fetcher);
    await client.connect();
    await client.invoke('bots.list', {});
    expect(String(fetcher.mock.calls[0]![0])).toBe(
      'https://personal.example.test/bridge/v1/connect',
    );
    const options = fetcher.mock.calls[1]![1]!;
    expect(options).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    expect(options.headers).toMatchObject({
      Authorization: `Bearer ${token}`,
      'X-Bot-Connection': connection,
    });
    expect(options.body).not.toContain(token);
  });

  it('does not accept agent REST as a Bot Mode plugin', async () => {
    const client = new BotBridgeClient(
      endpoint,
      token,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ features: { chat: true } })),
    );
    await expect(client.connect()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('sanitizes remote errors without exposing credentials or private addresses', async () => {
    const client = new BotBridgeClient(
      endpoint,
      token,
      vi.fn<typeof fetch>().mockRejectedValue(new Error(`${token} personal.example.test`)),
    );
    await expect(client.connect()).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
    try {
      await client.connect();
    } catch (error) {
      expect(String(error)).not.toContain(token);
      expect(String(error)).not.toContain('personal.example.test');
    }
  });

  it.each(['\n', '\n\n'])(
    'decodes %j-delimited events split across UTF-8 chunks',
    async (separator) => {
      const encoded = new TextEncoder().encode(
        '{"type":"bridge.ready"}' +
          separator +
          '{"type":"message.delta","session_id":"live","payload":{"text":"🤖"}}' +
          separator,
      );
      const body = new ReadableStream({
        start(controller) {
          for (const byte of encoded) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(connectedResponse())
        .mockResolvedValueOnce(
          new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }),
        );
      const client = new BotBridgeClient(endpoint, token, fetcher);
      const observer = vi.fn();
      await client.connect();
      await expect(client.events(observer)).rejects.toMatchObject({ code: 'DISCONNECTED' });
      expect(observer).toHaveBeenCalledWith({
        type: 'message.delta',
        session_id: 'live',
        payload: { text: '🤖' },
      });
    },
  );

  it('rejects a proxy HTML page or an event stream without the readiness handshake', async () => {
    for (const response of [
      new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
      new Response('{"type":"bridge.heartbeat"}\n', {
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
    ]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(connectedResponse())
        .mockResolvedValueOnce(response);
      const client = new BotBridgeClient(endpoint, token, fetcher);
      await client.connect();
      const observer = vi.fn();
      await expect(client.events(observer)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(observer).not.toHaveBeenCalled();
    }
  });

  it('identifies a timed-out stream handshake without exposing private errors', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(connectedResponse())
        .mockImplementationOnce(
          (_input, options) =>
            new Promise<Response>((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () => reject(new Error(token)));
            }),
        );
      const client = new BotBridgeClient(endpoint, token, fetcher);
      await client.connect();
      const rejected = expect(client.events(vi.fn())).rejects.toMatchObject({
        code: 'REQUEST_TIMEOUT',
      });
      await vi.advanceTimersByTimeAsync(35_001);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not accept a second ready frame that could clear a blocked workspace', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(connectedResponse())
      .mockResolvedValueOnce(
        new Response('{"type":"bridge.ready"}\n{"type":"bridge.ready"}\n', {
          headers: { 'Content-Type': 'application/x-ndjson' },
        }),
      );
    const client = new BotBridgeClient(endpoint, token, fetcher);
    await client.connect();
    const observer = vi.fn();
    await expect(client.events(observer)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('rejects late responses after disconnect and submits a bounded lease close', async () => {
    let resolve: (response: Response) => void = () => undefined;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(connectedResponse())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(Response.json({ disconnected: true }));
    const client = new BotBridgeClient(endpoint, token, fetcher);
    await client.connect();
    const pending = client.invoke('chat.send', { session_id: 'live', text: 'Hello' });
    client.disconnect();
    resolve(Response.json({ result: { accepted: true } }));
    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    expect(fetcher.mock.calls[2]![1]).toMatchObject({ method: 'DELETE' });
    await expect(client.invoke('bots.list', {})).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });
});

describe('full-profile photo routing', () => {
  it.each(['agent.onboard', 'bots.profile.update'])(
    'sends %s through the avatar route',
    async (operation) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(connectedResponse())
        .mockResolvedValue(Response.json({ result: { state: 'completed', profile: 'synthetic' } }));
      const client = new BotBridgeClient(endpoint, token, fetcher);
      await client.connect();
      await client.invoke(operation, {
        profile: 'synthetic',
        photo: 'data:image/png;base64,' + 'a'.repeat(100_000),
      });
      expect(String(fetcher.mock.calls[1]![0])).toBe(
        'https://personal.example.test/bridge/v1/avatar',
      );
    },
  );
});
