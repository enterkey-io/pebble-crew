import { build } from 'esbuild';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? '.audit/photo-routing.json');
const compiled = await build({
  stdin: {
    contents:
      "export { BotBridgeClient } from './packages/hermes-client/src/bridge'; export { normalizeEndpoint } from './packages/core/src/endpoint'; export { proxyBridge } from './packages/owner-service/src/bridge-proxy';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const { BotBridgeClient, normalizeEndpoint, proxyBridge } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc(data));
  return Buffer.concat([length, data, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(512, 0);
header.writeUInt32BE(512, 4);
header[8] = 8;
header[9] = 2;
const pixels = Buffer.alloc(512 * (512 * 3 + 1));
let seed = 123456;
for (let y = 0; y < 512; y++) {
  for (let x = 1; x <= 512 * 3; x++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    pixels[y * (512 * 3 + 1) + x] = seed & 255;
  }
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
const photo = 'data:image/png;base64,' + png.toString('base64');
const upstreamCalls = [];
const upstream = createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    upstreamCalls.push(request.url);
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
let origin;
const front = createServer((request, response) =>
  proxyBridge(request, response, origin, upstream.address().port),
);
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
const requests = [];
try {
  await listen(upstream);
  await listen(front);
  origin = `http://127.0.0.1:${front.address().port}`;
  const client = new BotBridgeClient(
    normalizeEndpoint(origin, true),
    't'.repeat(43),
    async (url, options) => {
      const response = await fetch(url, {
        ...options,
        headers: { ...options.headers, Origin: origin },
      });
      requests.push({
        route: new URL(url).pathname,
        status: response.status,
        bodyBytes: Buffer.byteLength(options.body ?? ''),
      });
      return response;
    },
  );
  await client.connect();
  const outcomes = [];
  for (const operation of [
    'agent.onboard',
    'bots.profile.update',
    'bots.appearance.update',
    'workspace.initialize',
  ]) {
    try {
      await client.invoke(operation, { profile: 'synthetic', photo });
      outcomes.push({ operation, completed: true });
    } catch (error) {
      outcomes.push({ operation, completed: false, code: error.code });
    }
  }
  client.disconnect();
  const report = {
    scope: 'real client and owner proxy with synthetic loopback upstream, no Hermes or model',
    pngBytes: png.length,
    outcomes,
    requests,
    upstreamCalls,
    passed:
      outcomes.every((outcome) => outcome.completed) &&
      requests
        .filter((request) => request.bodyBytes > 65_536)
        .every((request) => request.route === '/v1/avatar' && request.status === 200),
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  await Promise.all([close(front), close(upstream)]);
}
