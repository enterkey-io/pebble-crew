import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { proxyBridge } from './bridge-proxy';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function listen(server: Server) {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  return address.port;
}
it('forwards event bytes immediately, preserves framing and isolates a closed stream from RPC', async () => {
  let finish = () => {};
  let closed = false;
  const upstream = await listen(
    createServer((request, response) => {
      if (request.url !== '/v1/events') {
        response.setHeader('Content-Type', 'application/json');
        response.end('{"native":"responsive","age_ms":0}');
        return;
      }
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.flushHeaders();
      response.write('{"type":"bridge.ready"}\n\n');
      finish = () => response.end('{"type":"bridge.heartbeat"}\n\n');
      request.on('close', () => {
        closed = true;
      });
    }),
  );
  let origin = '';
  const port = await listen(
    createServer((request, response) => proxyBridge(request, response, origin, upstream)),
  );
  origin = `http://127.0.0.1:${port}`;
  const headers = {
    Origin: origin,
    Authorization: 'Bearer ' + 's'.repeat(43),
    'X-Bot-Connection': 'c'.repeat(43),
  };
  const response = await fetch(origin + '/v1/events', { headers });
  expect(response.headers.get('content-type')).toBe('application/x-ndjson');
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('{"type":"bridge.ready"}\n\n');
  // Receipt of ready before finish proves this proxy is not buffering until EOF.
  finish();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    '{"type":"bridge.heartbeat"}\n\n',
  );
  expect((await reader.read()).done).toBe(true);
  const health = await fetch(origin + '/v1/status', { headers });
  expect(await health.json()).toEqual({ native: 'responsive', age_ms: 0 });
  expect(closed).toBe(true);
});
