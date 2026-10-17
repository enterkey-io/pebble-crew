// Local Workerd/D1 acceptance. No Cloudflare account or external services are used.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, jwtVerify, importJWK } from 'jose';
import { chromium } from '@playwright/test';
const directory = await mkdtemp(join(tmpdir(), 'workspace-worker-'));
const config = resolve('apps/owner-worker/wrangler.jsonc');
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const vars = resolve('apps/owner-worker/.dev.vars');
const previous = await readFile(vars).catch(() => null);
const reservation = createServer();
await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const origin = `http://127.0.0.1:${port}`;
const proof = 'S'.repeat(43);
const pair = await generateKeyPair('EdDSA', { extractable: true });
const settings = {
  origin,
  bridgeUrl: 'http://127.0.0.1:8799',
  development: true,
  installationId: crypto.randomUUID(),
  keyId: 'fixture-key',
  authSecret: crypto.randomUUID() + crypto.randomUUID(),
  signingKey: await exportJWK(pair.privateKey),
};
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_SEND_METRICS: 'false' };
let server;
let browser;
function run(args) {
  return execFileSync(process.execPath, [cli, ...args, '--config', config], { env, stdio: 'pipe' });
}
async function start() {
  server = spawn(
    process.execPath,
    [
      cli,
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      '0',
      '--persist-to',
      directory,
      '--config',
      config,
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  server.stdout.on('data', (d) => {
    output += d;
  });
  server.stderr.on('data', (d) => {
    output += d;
  });
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error('Local worker exited: ' + output.slice(-3000));
    try {
      const r = await fetch(origin + '/api/instance/status');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Worker failed to start: ' + output.slice(-3000));
}
async function stop() {
  const child = server;
  server = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((r) => {
    child.once('close', r);
    child.kill('SIGTERM');
  });
  // Wrangler's wrapper can exit before its workerd listener finishes shutting down.
  for (let attempt = 0; attempt < 50; attempt++) {
    const listening = await new Promise((r) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        r(true);
      });
      socket.once('error', () => r(false));
    });
    if (!listening) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The local workerd test listener did not stop.');
}
async function call(path, body, cookie) {
  const r = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return r;
}
try {
  await writeFile(vars, "OWNER_SETTINGS='" + JSON.stringify(settings) + "'\n", { mode: 0o600 });
  run([
    'd1',
    'migrations',
    'apply',
    'hermes-workspace-owner',
    '--local',
    '--persist-to',
    directory,
  ]);
  const hash = createHash('sha256').update(proof).digest('hex');
  run([
    'd1',
    'execute',
    'hermes-workspace-owner',
    '--local',
    '--persist-to',
    directory,
    '--command',
    `INSERT INTO owner_setup VALUES(1,'${hash}',${Date.now() + 100000});`,
  ]);
  await start();
  const b = await call('/api/bootstrap', {
    proof,
    username: 'owner',
    password: 'synthetic-password-123',
  });
  assert.equal(b.status, 201, await b.text());
  const login = await call('/api/auth/sign-in/username', {
    username: 'owner',
    password: 'synthetic-password-123',
    rememberMe: true,
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  assert(cookie);
  // Exercise the real workerd encoder and D1 record, then decode independently in Chromium.
  const pixels = Buffer.alloc(192 * 192 * 4);
  let seed = 271828;
  for (let offset = 0; offset < pixels.length - 4; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels[offset + channel] = seed & 255;
    }
    pixels[offset + 3] = 255;
  }
  const upload = { pixels: pixels.toString('base64') };
  assert.equal((await call('/api/owner/photo', upload)).status, 401);
  assert.equal((await call('/api/owner/photo', { pixels: '<svg/>' }, cookie)).status, 400);
  const blocked = await fetch(origin + '/api/owner/photo', {
    method: 'POST',
    headers: {
      Origin: 'https://untrusted.invalid',
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upload),
  });
  assert.equal(blocked.status, 403);
  assert.equal(
    (await call('/api/owner/photo', { pixels: 'a'.repeat(205000) }, cookie)).status,
    413,
  );
  const photo = await call('/api/owner/photo', upload, cookie);
  assert.equal(photo.status, 200, await photo.clone().text());
  const { image } = await photo.json();
  assert(image.startsWith('data:image/png;base64,'));
  browser = await chromium.launch();
  const page = await browser.newPage();
  const decoded = await page.evaluate(async (url) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let value = '';
    for (let i = 0; i < bytes.length; i += 8192)
      value += String.fromCharCode(...bytes.subarray(i, i + 8192));
    bitmap.close();
    return { width: canvas.width, height: canvas.height, pixels: btoa(value) };
  }, image);
  assert.deepEqual(decoded, { width: 192, height: 192, pixels: upload.pixels });
  await stop();
  await start();
  const session = await call('/api/auth/get-session', undefined, cookie);
  assert.equal((await session.json()).user.image, image);
  const ticket = await call('/api/hermes/ticket', {}, cookie);
  assert.equal(ticket.status, 200, await ticket.clone().text());
  const payload = await ticket.json();
  const key = await importJWK(await exportJWK(pair.publicKey), 'EdDSA');
  await jwtVerify(payload.ticket, key, { issuer: origin, audience: settings.installationId });
  assert.equal((await call('/api/owner/photo', { pixels: null }, cookie)).status, 200);
  const removed = await call('/api/auth/get-session', undefined, cookie);
  assert.equal((await removed.json()).user.image, null);
  assert.equal((await call('/api/auth/sign-out', {}, cookie)).status, 200);
  assert.equal((await call('/api/hermes/ticket', {}, cookie)).status, 401);
  assert.equal((await call('/api/owner/photo', upload, cookie)).status, 401);
  console.log(
    'Local Cloudflare Worker/D1: login, photo validation and browser pixel decode, restart persistence, removal, signed ticket and logout passed.',
  );
} finally {
  await browser?.close();
  await stop();
  if (previous) await writeFile(vars, previous);
  else await rm(vars, { force: true });
  await rm(directory, { recursive: true, force: true });
}
