import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, chmod, lstat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { generateKeyPair, exportJWK } from 'jose';
import { NodeOwnerDatabase } from '../../packages/owner-service/src/node-store';
import { createOwnerService, digest } from '../../packages/owner-service/src/service';
import { ownerBodyLimit } from '../../packages/owner-service/src/photo';
import type { OwnerSettings } from '../../packages/owner-service/src/service';
import { proxyBridge, proxyBridgeUpgrade } from '../../packages/owner-service/src/bridge-proxy';
import ownerSchema from '../../packages/owner-service/src/schema.sql';

const command = process.argv[2];
function flag(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const directory = resolve(flag('--state') ?? process.env.WORKSPACE_STATE ?? '.local/owner');
const settingsPath = resolve(directory, 'settings.json');
const root = resolve(flag('--assets') ?? 'apps/web/dist');
await mkdir(directory, { recursive: true, mode: 0o700 });
if ((await lstat(directory)).isSymbolicLink())
  throw new Error('Private state must be a real directory');
await chmod(directory, 0o700);
if (command === 'init') {
  const origin = flag('--origin'),
    bridgeUrl = flag('--bridge');
  if (!origin || !bridgeUrl) throw new Error('init requires --origin and --bridge');
  const pair = await generateKeyPair('EdDSA', { extractable: true });
  const settings: OwnerSettings = {
    origin,
    bridgeUrl,
    installationId: crypto.randomUUID(),
    keyId: crypto.randomUUID(),
    authSecret: randomBytes(48).toString('base64url'),
    signingKey: await exportJWK(pair.privateKey),
    ...(flag('--development') === 'yes' ? { development: true } : {}),
  };
  // Validate origins and key format before writing any installation state.
  createOwnerService(
    undefined,
    { first: async () => null, batch: async () => undefined },
    settings,
  );
  await writeFile(settingsPath, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
  const publicKey = await exportJWK(pair.publicKey);
  await writeFile(
    resolve(directory, 'trust.json'),
    JSON.stringify({
      schema: 1,
      issuer: origin,
      audience: settings.installationId,
      origin,
      key_id: settings.keyId,
      public_key: publicKey,
    }),
    { mode: 0o600, flag: 'wx' },
  );
}
const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as OwnerSettings;
await chmod(settingsPath, 0o600);
const databasePath = resolve(directory, 'owner.sqlite');
const db = new DatabaseSync(databasePath);
await chmod(databasePath, 0o600);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000;');
// Versioned pinned-library schema; never run ad-hoc library migrations on live requests.
db.exec(
  await readFile(resolve('apps/owner-worker/migrations/0001_owner.sql'), 'utf8').then((sql) =>
    sql
      .replaceAll('create table ', 'create table if not exists ')
      .replaceAll('create index ', 'create index if not exists '),
  ),
);
const store = new NodeOwnerDatabase(db);
db.exec(ownerSchema);
if (command === 'init' || command === 'recover') {
  const code = randomBytes(32).toString('base64url');
  const statements =
    command === 'recover'
      ? [
          { sql: 'DELETE FROM session' },
          { sql: 'DELETE FROM account' },
          { sql: 'DELETE FROM "user"' },
          { sql: 'DELETE FROM owner_claim' },
        ]
      : [];
  await store.batch([
    ...statements,
    {
      sql: 'INSERT OR REPLACE INTO owner_setup(id,value,expires) VALUES(1,?,?)',
      values: [await digest(code), Date.now() + 24 * 60 * 60 * 1000],
    },
  ]);
  await writeFile(resolve(directory, 'setup-code.txt'), code + '\n', { mode: 0o600 });
  console.log(
    `Owner setup is ready. Give the owner the code from ${resolve(directory, 'setup-code.txt')} privately. Enroll ${resolve(directory, 'trust.json')} on Hermes. No credentials were printed.`,
  );
  db.close();
} else if (command === 'serve') {
  const origin = new URL(settings.origin);
  const bridgePort = flag('--bridge-port') ? Number(flag('--bridge-port')) : undefined;
  if (
    bridgePort !== undefined &&
    (!Number.isInteger(bridgePort) ||
      bridgePort < 1024 ||
      bridgePort > 65535 ||
      settings.bridgeUrl !== settings.origin)
  )
    throw new Error('Combined hosting requires a valid loopback bridge port and one public origin');
  const service = createOwnerService(db, store, {
    ...settings,
    nativeDevices: bridgePort !== undefined,
  });
  const headerText = await readFile(resolve(root, '_headers'), 'utf8');
  const headers = Object.fromEntries(
    headerText
      .split('\n')
      .filter((line) => line.startsWith('  '))
      .map((line) => {
        const i = line.indexOf(':');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
  );
  if (bridgePort !== undefined && headers['Content-Security-Policy'])
    headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(
      "connect-src 'self' https: wss:",
      `connect-src 'self' ${settings.origin.replace(/^https:/, 'wss:')}`,
    );
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.ttf': 'font/ttf',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.md': 'text/plain; charset=utf-8',
  };
  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    try {
      if (
        req.headers.host !== origin.host ||
        !req.url?.startsWith('/') ||
        req.url.startsWith('//')
      ) {
        res.writeHead(403).end();
        return;
      }
      for (const name of [
        'host',
        'origin',
        'content-length',
        'authorization',
        'x-bot-connection',
        'content-type',
        'sec-fetch-site',
      ])
        if (req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length > 1) {
          res.writeHead(400).end();
          return;
        }
      const url = new URL(req.url, origin);
      if (bridgePort !== undefined && url.pathname.startsWith('/v1/')) {
        const device = await service.bridgeDevice(
          String(req.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        if (device === false) {
          res.writeHead(401).end();
          return;
        }
        proxyBridge(req, res, settings.origin, bridgePort, device ?? undefined);
        return;
      }
      if (
        url.pathname.startsWith('/api/') ||
        url.pathname === '/.well-known/hermes-workspace.json'
      ) {
        const parts: Buffer[] = [];
        let length = 0;
        const limit = ownerBodyLimit(url.pathname, req.method ?? 'GET');
        for await (const part of req) {
          length += part.length;
          if (length > limit) {
            res.writeHead(413).end();
            return;
          }
          parts.push(part);
        }
        const requestHeaders = new Headers();
        for (const [name, value] of Object.entries(req.headers))
          if (value) requestHeaders.set(name, Array.isArray(value) ? value.join(',') : value);
        const request = new Request(url, {
          method: req.method ?? 'GET',
          headers: requestHeaders,
          ...(parts.length ? { body: Buffer.concat(parts) } : {}),
        });
        const response = await service.fetch(request);
        response.headers.forEach((v, k) => {
          if (k !== 'set-cookie') res.setHeader(k, v);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader('Set-Cookie', cookies);
        res.writeHead(response.status).end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (
        !['GET', 'HEAD'].includes(req.method ?? '') ||
        url.search ||
        url.pathname === '/_headers'
      ) {
        res.writeHead(404).end();
        return;
      }
      const path = resolve(
        root,
        '.' +
          decodeURIComponent(
            url.pathname === '/'
              ? '/index.html'
              : url.pathname === '/install'
                ? '/install.html'
                : url.pathname,
          ),
      );
      if (!path.startsWith(root + sep) || !mime[extname(path)]) {
        res.writeHead(404).end();
        return;
      }
      const data = await readFile(path);
      res.setHeader('Content-Type', mime[extname(path)]!);
      res.writeHead(200).end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404).end();
    }
  });
  server.on('upgrade', (request, socket, head) => {
    if (bridgePort === undefined) {
      socket.destroy();
      return;
    }
    proxyBridgeUpgrade(
      request,
      socket as import('node:net').Socket,
      head,
      settings.origin,
      bridgePort,
    );
  });
  server.listen(Number(flag('--port') ?? 8081), '127.0.0.1');
  function shutdown() {
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 5000);
    deadline.unref();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  }
  const managerPid = Number(process.env.WORKSPACE_SUPERVISOR_PID ?? 0);
  if (managerPid) {
    const parentWatch = setInterval(() => {
      if (process.ppid !== managerPid) shutdown();
    }, 1000);
    parentWatch.unref();
  }
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, shutdown);
} else throw new Error('Use init, serve or recover');
