import { createServer, type Server } from 'node:http';
import { it, expect } from 'vitest';
import { proxyBridge } from './bridge-proxy';

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing test listener');
  return address.port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

it('marks a native device connected only after its bridge handshake succeeds', async () => {
  let status = 401;
  let connected = 0;
  let body = '{}';
  const upstream = createServer((_request, response) =>
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(body),
  );
  const upstreamPort = await listen(upstream);
  const proxy = createServer((request, response) =>
    proxyBridge(request, response, 'https://owner.example', upstreamPort, {
      alive: async () => true,
      connected: async () => {
        connected++;
      },
    }),
  );
  const port = await listen(proxy);
  try {
    const send = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { Origin: 'https://owner.example', 'Content-Type': 'application/json' },
        body: '{}',
      });
      await response.text();
      return response.status;
    };
    expect(await send('/v1/connect')).toBe(401);
    expect(connected).toBe(0);
    status = 200;
    expect(await send('/v1/rpc')).toBe(200);
    expect(connected).toBe(0);
    expect(await send('/v1/connect')).toBe(502);
    expect(connected).toBe(0);
    body = JSON.stringify({ protocol: 'hermes-bot-web.v1', connection: 'synthetic-lease' });
    expect(await send('/v1/connect')).toBe(200);
    expect(connected).toBe(1);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

it('closes an established native event stream when that device is revoked', async () => {
  let alive = true;
  let upstreamClosed = false;
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    response.write('{"type":"bridge.ready"}\n');
    response.on('close', () => {
      upstreamClosed = true;
    });
  });
  const upstreamPort = await listen(upstream);
  const proxy = createServer((request, response) =>
    proxyBridge(request, response, 'https://owner.example', upstreamPort, {
      alive: async () => alive,
      connected: async () => {
        throw Error('Events must not confirm enrollment');
      },
    }),
  );
  const port = await listen(proxy);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/events`, {
      headers: { Origin: 'https://owner.example' },
    });
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    alive = false;
    expect((await reader.read()).done).toBe(true);
    await expect.poll(() => upstreamClosed).toBe(true);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
