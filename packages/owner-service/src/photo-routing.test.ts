import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { deflateSync } from 'node:zlib';
import { BotBridgeClient } from '@hermes-client/protocol';
import { normalizeEndpoint } from '@hermes-client/core';
import { proxyBridge } from './bridge-proxy';

function pngPhoto() {
  function chunk(type: string, bytes: Buffer) {
    const data = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(512, 0);
  header.writeUInt32BE(512, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(512 * (512 * 3 + 1));
  let seed = 123456;
  for (let y = 0; y < 512; y++)
    for (let x = 1; x <= 512 * 3; x++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels[y * (512 * 3 + 1) + x] = seed & 255;
    }
  return (
    'data:image/png;base64,' +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]).toString('base64')
  );
}
async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

describe('client and fixed owner proxy photo route', () => {
  it('forwards detailed profiles and keeps old small RPC requests and exact byte caps', async () => {
    const calls: { route: string; bytes: number }[] = [];
    const upstream = createServer((request, response) => {
      let bytes = 0;
      request.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      request.on('end', () => {
        calls.push({ route: request.url ?? '', bytes });
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify(
            request.url === '/v1/connect'
              ? { protocol: 'hermes-bot-web.v1', connection: 'c'.repeat(43) }
              : { result: { saved: true } },
          ),
        );
      });
    });
    const port = await listen(upstream);
    let origin = '';
    const front = createServer((request, response) => proxyBridge(request, response, origin, port));
    origin = `http://127.0.0.1:${await listen(front)}`;
    const send = (route: string, body: string, extra: Record<string, string> = {}) =>
      fetch(origin + route, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', ...extra },
        body,
      });
    try {
      const client = new BotBridgeClient(
        normalizeEndpoint(origin, true),
        't'.repeat(43),
        (input, init) => fetch(input, { ...init, headers: { ...init?.headers, Origin: origin } }),
      );
      await client.connect();
      const photo = pngPhoto();
      expect(photo.length).toBeGreaterThan(65_536);
      expect(photo.length).toBeLessThan(3_000_000);
      for (const operation of [
        'agent.onboard',
        'bots.profile.update',
        'bots.appearance.update',
        'workspace.initialize',
      ]) {
        await expect(client.invoke(operation, { profile: 'synthetic', photo })).resolves.toEqual({
          saved: true,
        });
        expect(calls.at(-1)?.route).toBe('/v1/avatar');
      }
      for (const operation of ['agent.onboard', 'bots.profile.update']) {
        const response = await send(
          '/v1/rpc',
          JSON.stringify({ operation, params: { photo: null } }),
        );
        expect(response.status).toBe(200);
        await response.body?.cancel();
      }
      for (const [route, bytes, expected] of [
        ['/v1/rpc', 65_536, 200],
        ['/v1/rpc', 65_537, 413],
        ['/v1/avatar', 3_000_000, 200],
        ['/v1/avatar', 3_000_001, 413],
      ] as const) {
        const response = await send(route, ' '.repeat(bytes));
        expect(response.status).toBe(expected);
        await response.body?.cancel();
      }
      for (const [route, extra] of [
        ['/v1/arbitrary', {}],
        ['/v1/rpc?token=forbidden', {}],
        ['/v1/avatar', { Origin: 'https://evil.test' }],
      ] as const) {
        const response = await send(route, '{}', extra);
        expect(response.status).toBe(403);
        await response.body?.cancel();
      }
      expect(
        calls.filter((call) => call.route === '/v1/avatar' && call.bytes > 65_536),
      ).toHaveLength(5);
    } finally {
      await close(front);
      await close(upstream);
    }
  });
});
