import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { username } from 'better-auth/plugins';
import { hashPassword } from 'better-auth/crypto';
import { importJWK, SignJWT } from 'jose';
import type { JWK } from 'jose';
import { ownerBodyLimit, photoPixels, encodeOwnerPhoto, ownerPhotoValue } from './photo';
import { createDeviceService } from './devices';

export type Statement = { sql: string; values?: (string | number | null)[] };
export interface OwnerDatabase {
  first<T>(sql: string, values?: (string | number | null)[]): Promise<T | null>;
  batch(statements: Statement[]): Promise<void>;
}
export interface OwnerSettings {
  origin: string;
  bridgeUrl: string;
  installationId: string;
  keyId: string;
  authSecret: string;
  signingKey: JWK;
  development?: boolean;
  nativeDevices?: boolean;
}
export function authOptions(database: BetterAuthOptions['database'], settings: OwnerSettings) {
  return {
    database,
    baseURL: settings.origin,
    basePath: '/api/auth',
    secret: settings.authSecret,
    telemetry: { enabled: false },
    logger: { disabled: true },
    trustedOrigins: [settings.origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 32 })],
    rateLimit: { enabled: true, storage: 'database' as const, window: 60, max: 30 },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: !settings.development,
      defaultCookieAttributes: {
        sameSite: 'strict' as const,
        httpOnly: true,
        secure: !settings.development,
      },
      ipAddress: { disableIpTracking: true },
    },
  } satisfies BetterAuthOptions;
}
export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
}
const allowedAuth = new Map([
  ['/api/auth/sign-in/username', 'POST'],
  ['/api/auth/sign-out', 'POST'],
  ['/api/auth/get-session', 'GET'],
  ['/api/auth/change-password', 'POST'],
  ['/api/auth/list-sessions', 'GET'],
  ['/api/auth/revoke-session', 'POST'],
  ['/api/auth/revoke-other-sessions', 'POST'],
]);
export function createOwnerService(
  database: BetterAuthOptions['database'],
  store: OwnerDatabase,
  settings: OwnerSettings,
) {
  const origin = new URL(settings.origin);
  if (
    origin.origin !== settings.origin ||
    (origin.protocol !== 'https:' &&
      !(settings.development && ['localhost', '127.0.0.1'].includes(origin.hostname)))
  )
    throw new Error('Exact HTTPS owner origin required');
  const bridge = new URL(settings.bridgeUrl);
  if (
    bridge.origin !== settings.bridgeUrl ||
    (bridge.protocol !== 'https:' &&
      !(settings.development && ['localhost', '127.0.0.1'].includes(bridge.hostname)))
  )
    throw new Error('Exact HTTPS bridge origin required');
  const auth = betterAuth(authOptions(database, settings));
  function json(value: unknown, status = 200) {
    return Response.json(value, {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  async function limited(key: string, max: number, window: number) {
    const now = Math.floor(Date.now() / 1000);
    await store.batch([
      {
        sql: `INSERT INTO owner_limit(key,start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET start=CASE WHEN start+?<=? THEN ? ELSE start END,count=CASE WHEN start+?<=? THEN 1 ELSE count+1 END`,
        values: [key, now, window, now, now, window, now],
      },
    ]);
    const row = await store.first<{ count: number }>('SELECT count FROM owner_limit WHERE key=?', [
      key,
    ]);
    return !!row && row.count <= max;
  }
  const devices = createDeviceService(store, settings, digest, limited);
  return {
    bridgeDevice: (token: string) => devices.bridge(token),
    async fetch(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        if (url.origin !== settings.origin || url.search)
          return json({ error: 'Request denied' }, 403);
        const suppliedOrigin = request.headers.get('Origin');
        if (
          (suppliedOrigin && suppliedOrigin !== settings.origin) ||
          (request.method !== 'GET' && suppliedOrigin !== settings.origin)
        )
          return json({ error: 'Request denied' }, 403);
        if (request.headers.get('Sec-Fetch-Site') === 'cross-site')
          return json({ error: 'Request denied' }, 403);
        const bodyLimit = ownerBodyLimit(url.pathname, request.method);
        if (Number(request.headers.get('Content-Length') ?? '0') > bodyLimit)
          return json({ error: 'Request too large' }, 413);
        // Bound chunked bodies too; neither the auth library nor JSON parser sees an unlimited stream.
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          const reader = request.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader) {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.byteLength;
              if (size > bodyLimit) {
                await reader.cancel();
                return json({ error: 'Request too large' }, 413);
              }
              chunks.push(part.value);
            }
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const part of chunks) {
            bytes.set(part, offset);
            offset += part.length;
          }
          request = new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: bytes,
          });
        }
        if (url.pathname === '/.well-known/hermes-workspace.json' && request.method === 'GET') {
          const publicKey = { ...settings.signingKey };
          delete publicKey.d;
          return json({
            schema: 1,
            issuer: settings.origin,
            origin: settings.origin,
            audience: settings.installationId,
            key_id: settings.keyId,
            public_key: publicKey,
          });
        }
        const claimed = await store.first<{ user_id: string }>(
          'SELECT user_id FROM owner_claim WHERE id=1',
        );
        if (url.pathname === '/api/instance/status' && request.method === 'GET')
          return json({ setupRequired: !claimed });
        if (url.pathname === '/api/bootstrap' && request.method === 'POST') {
          if (claimed) return json({ error: 'Owner already created. Sign in.' }, 409);
          if (!(await limited('bootstrap', 10, 900)))
            return json({ error: 'Too many attempts. Try again later.' }, 429);
          const body: unknown = await request.json();
          if (
            !body ||
            typeof body !== 'object' ||
            Object.keys(body).sort().join(',') !== 'password,proof,username'
          )
            return json({ error: 'Invalid setup' }, 400);
          const b = body as Record<string, unknown>;
          if (
            typeof b.proof !== 'string' ||
            !/^[A-Za-z0-9_-]{43}$/.test(b.proof) ||
            typeof b.username !== 'string' ||
            !/^[a-zA-Z0-9_]{3,32}$/.test(b.username) ||
            typeof b.password !== 'string' ||
            b.password.length < 12 ||
            b.password.length > 128
          )
            return json(
              { error: 'Use a valid setup code, username and a password of 12–128 characters.' },
              400,
            );
          const proofHash = await digest(b.proof);
          const proof = await store.first<{ value: string; expires: number }>(
            'SELECT value,expires FROM owner_setup WHERE id=1',
          );
          if (!proof || proof.value !== proofHash || proof.expires <= Date.now())
            return json({ error: 'Setup code is invalid or expired.' }, 403);
          const id = crypto.randomUUID(),
            accountId = crypto.randomUUID(),
            now = Date.now();
          const password = await hashPassword(b.password);
          // Both adapters execute this batch as one transaction. The singleton claim, proof
          // consumption and library-compatible user/account rows either all commit or none do.
          await store.batch([
            {
              sql: 'INSERT INTO owner_claim(id,user_id) SELECT 1,? FROM owner_setup WHERE id=1 AND value=? AND expires>?',
              values: [id, proofHash, now],
            },
            {
              sql: 'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername) SELECT ?,?,?,1,?,?,?,? FROM owner_claim WHERE user_id=?',
              values: [
                id,
                b.username,
                'owner@instance.invalid',
                now,
                now,
                b.username.toLowerCase(),
                b.username,
                id,
              ],
            },
            {
              sql: "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) SELECT ?,?,'credential',?,?,?,? FROM owner_claim WHERE user_id=?",
              values: [accountId, id, id, password, now, now, id],
            },
            {
              sql: 'DELETE FROM owner_setup WHERE EXISTS(SELECT 1 FROM owner_claim WHERE user_id=?)',
              values: [id],
            },
          ]);
          const created = await store.first<{ user_id: string }>(
            'SELECT user_id FROM owner_claim WHERE user_id=?',
            [id],
          );
          return created
            ? json({ created: true }, 201)
            : json({ error: 'Setup code already consumed.' }, 409);
        }
        if (allowedAuth.get(url.pathname) === request.method) {
          if (!claimed) return json({ error: 'Finish owner setup first.' }, 403);
          if (url.pathname === '/api/auth/sign-in/username' && !(await limited('login', 20, 60)))
            return json({ error: 'Too many attempts. Try again in a minute.' }, 429);
          const result = await auth.handler(request);
          const headers = new Headers(result.headers);
          headers.set('Cache-Control', 'no-store');
          return new Response(result.body, { status: result.status, headers });
        }
        if (settings.nativeDevices && claimed) {
          const result = await devices.public(request, claimed.user_id);
          if (result) return result;
        }
        const session = await auth.api.getSession({ headers: request.headers });
        if (!claimed || !session || session.user.id !== claimed.user_id)
          return json({ error: 'Sign in to your workspace.' }, 401);
        if (settings.nativeDevices) {
          const result = await devices.owner(request, claimed.user_id);
          if (result) return result;
        }
        if (url.pathname === '/api/owner/photo' && request.method === 'POST') {
          if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json')
            return json({ error: 'Choose a photo.' }, 400);
          if (!(await limited('owner-photo:' + claimed.user_id, 10, 60)))
            return json({ error: 'Try again in a minute.' }, 429);
          const pixels = photoPixels(await request.json());
          const image = pixels ? await encodeOwnerPhoto(pixels) : null;
          const current = await auth.api.getSession({ headers: request.headers });
          if (
            !current ||
            current.session.id !== session.session.id ||
            current.user.id !== claimed.user_id
          )
            return json({ error: 'Sign in to your workspace.' }, 401);
          await store.batch([
            {
              sql: 'UPDATE "user" SET image=?,updatedAt=? WHERE id=? AND EXISTS(SELECT 1 FROM session WHERE id=? AND userId=?) AND EXISTS(SELECT 1 FROM owner_claim WHERE id=1 AND user_id=?)',
              values: [
                image,
                new Date().toISOString(),
                claimed.user_id,
                session.session.id,
                claimed.user_id,
                claimed.user_id,
              ],
            },
          ]);
          const saved = await auth.api.getSession({ headers: request.headers });
          if (
            !saved ||
            saved.session.id !== session.session.id ||
            saved.user.id !== claimed.user_id
          )
            return json({ error: 'Sign in to your workspace.' }, 401);
          return json({ image: ownerPhotoValue(saved.user.image) });
        }
        if (url.pathname === '/api/instance/config' && request.method === 'GET')
          return json({ bridgeUrl: settings.bridgeUrl, installationId: settings.installationId });
        if (url.pathname === '/api/hermes/ticket' && request.method === 'POST') {
          const key = await importJWK(settings.signingKey, 'EdDSA');
          const ticket = await new SignJWT({
            origin: settings.origin,
            scope: 'workspace.owner',
            sid: await digest(session.session.id),
          })
            .setProtectedHeader({ alg: 'EdDSA', kid: settings.keyId, typ: 'JWT' })
            .setIssuer(settings.origin)
            .setAudience(settings.installationId)
            .setSubject(claimed.user_id)
            .setJti(crypto.randomUUID())
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(key);
          return json({ ticket, expiresIn: 300, bridgeUrl: settings.bridgeUrl });
        }
        return json({ error: 'Not found' }, 404);
      } catch {
        // Never reflect library/DB errors, request bodies, credentials or signing material.
        return json({ error: 'The request could not be completed. Refresh before retrying.' }, 400);
      }
    },
  };
}
