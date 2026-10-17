import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { bridgeRoute } from '@hermes-client/core';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Fixed loopback destination and narrow protocol routes; never a general proxy. */
export function proxyBridge(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  origin: string,
  port: number,
) {
  const url = new URL(incoming.url!, origin);
  const callback = url.pathname === '/v1/oauth/callback';
  const route = bridgeRoute(url.pathname);
  const suppliedOrigin = incoming.headers.origin;
  if (
    !route?.methods.includes(incoming.method ?? '') ||
    (!callback && url.search) ||
    (suppliedOrigin && suppliedOrigin !== origin) ||
    (!callback && !suppliedOrigin && incoming.headers['sec-fetch-site'] !== 'same-origin')
  ) {
    outgoing.writeHead(403).end();
    return;
  }
  const limit = route.maxBytes;
  if (Number(incoming.headers['content-length'] ?? 0) > limit) {
    outgoing.writeHead(413).end();
    return;
  }
  const headers: Record<string, string | string[]> = { host: new URL(origin).host };
  for (const name of [
    'origin',
    'authorization',
    'content-type',
    'content-length',
    'x-bot-connection',
    'sec-fetch-site',
  ]) {
    const value = incoming.headers[name];
    if (value) headers[name] = value;
  }
  const upstream = request(
    {
      hostname: '127.0.0.1',
      port,
      method: incoming.method,
      path: url.pathname + url.search,
      headers,
    },
    (response) => {
      // The integration cannot set owner-login cookies or replace security headers.
      const responseHeaders: Record<string, string | string[]> = {};
      for (const name of ['content-type', 'content-disposition', 'location', 'retry-after']) {
        const value = response.headers[name];
        if (value) responseHeaders[name] = value;
      }
      responseHeaders['cache-control'] = 'no-store, no-transform';
      responseHeaders['x-accel-buffering'] = 'no';
      outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
      outgoing.flushHeaders();
      response.on('error', () => outgoing.end());
      response.pipe(outgoing);
      outgoing.on('close', () => response.destroy());
    },
  );
  upstream.setTimeout(45000, () => upstream.destroy());
  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(503, { 'Retry-After': '2' });
    outgoing.end();
  });
  outgoing.on('close', () => upstream.destroy());
  let consumed = 0;
  incoming.on('data', (chunk: Buffer) => {
    consumed += chunk.length;
    if (consumed > limit) {
      if (!outgoing.headersSent) outgoing.writeHead(413);
      outgoing.end();
      upstream.destroy();
      incoming.unpipe(upstream);
      incoming.destroy();
    }
  });
  incoming.on('aborted', () => upstream.destroy());
  incoming.pipe(upstream);
}

/** One fixed WebSocket route. Owner cookies and arbitrary destinations never cross it. */
export function proxyBridgeUpgrade(
  incoming: IncomingMessage,
  socket: import('node:net').Socket,
  head: Buffer,
  origin: string,
  port: number,
) {
  const url = new URL(incoming.url ?? '/', origin);
  const reject = () => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  };
  if (
    incoming.method !== 'GET' ||
    incoming.headers.upgrade?.toLowerCase() !== 'websocket' ||
    !String(incoming.headers.connection).toLowerCase().split(/,\s*/).includes('upgrade') ||
    incoming.headers.host !== new URL(origin).host ||
    incoming.headers.origin !== origin ||
    url.pathname !== '/v1/computer/stream' ||
    [...url.searchParams].length !== 1 ||
    !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('ticket') ?? '') ||
    incoming.headers['sec-websocket-version'] !== '13' ||
    !/^[A-Za-z0-9+/]{22}==$/.test(String(incoming.headers['sec-websocket-key'] ?? '')) ||
    ['host', 'origin', 'sec-websocket-key'].some(
      (name) =>
        incoming.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length !== 1,
    )
  ) {
    reject();
    return;
  }
  const upstream = request({
    hostname: '127.0.0.1',
    port,
    method: 'GET',
    path: url.pathname + url.search,
    headers: {
      Host: new URL(origin).host,
      Origin: origin,
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': String(incoming.headers['sec-websocket-key']),
      'Sec-WebSocket-Version': '13',
    },
  });
  upstream.setTimeout(10000, () => upstream.destroy());
  upstream.on('upgrade', (response, peer, buffer) => {
    upstream.setTimeout(0);
    if (
      response.statusCode !== 101 ||
      response.headers['sec-websocket-accept'] !==
        createHash('sha1')
          .update(
            String(incoming.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
          )
          .digest('base64')
    ) {
      peer.destroy();
      reject();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        String(response.headers['sec-websocket-accept']) +
        '\r\n\r\n',
    );
    if (buffer.length) socket.write(buffer);
    if (head.length) peer.write(head);
    socket.pipe(peer);
    peer.pipe(socket);
    socket.on('error', () => peer.destroy());
    peer.on('error', () => socket.destroy());
    socket.on('close', () => peer.destroy());
    peer.on('close', () => socket.destroy());
  });
  upstream.on('response', () => {
    upstream.destroy();
    reject();
  });
  upstream.on('error', reject);
  socket.on('close', () => upstream.destroy());
  upstream.end();
}
