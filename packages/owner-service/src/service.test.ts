import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, jwtVerify } from 'jose';
import { createOwnerService, digest } from './service';
import type { OwnerSettings } from './service';
import { NodeOwnerDatabase } from './node-store';
import { inflateSync } from 'node:zlib';
import { OWNER_PHOTO_BYTES, OWNER_PHOTO_SIDE, OWNER_PHOTO_BODY_LIMIT } from './photo';

describe('private owner instance', () => {
  let db: DatabaseSync, settings: OwnerSettings, service: ReturnType<typeof createOwnerService>;
  const proof = 'Z'.repeat(43),
    origin = 'https://owner.example';
  function req(path: string, body?: unknown, cookie?: string) {
    return new Request(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('apps/owner-worker/migrations/0001_owner.sql', 'utf8'));
    const pair = await generateKeyPair('EdDSA', { extractable: true });
    settings = {
      origin,
      bridgeUrl: 'https://hermes.example',
      installationId: crypto.randomUUID(),
      keyId: 'owner-key',
      authSecret: crypto.randomUUID() + crypto.randomUUID(),
      signingKey: await exportJWK(pair.privateKey),
    };
    db.prepare('INSERT INTO owner_setup VALUES(1,?,?)').run(
      await digest(proof),
      Date.now() + 100000,
    );
    service = createOwnerService(db, new NodeOwnerDatabase(db), settings);
  });
  afterEach(() => db.close());
  async function setup() {
    return service.fetch(
      req('/api/bootstrap', { proof, username: 'Elliott', password: 'test-password-private-123' }),
    );
  }
  async function login() {
    const r = await service.fetch(
      req('/api/auth/sign-in/username', {
        username: 'elliott',
        password: 'test-password-private-123',
      }),
    );
    expect(r.status).toBe(200);
    return r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  }
  it('consumes ownership proof atomically and allows only one owner under a race', async () => {
    const result = await Promise.all([setup(), setup()]);
    expect(result.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM "user"').get()?.n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account').get()?.n).toBe(1);
    expect(db.prepare('SELECT * FROM owner_setup').get()).toBeUndefined();
    expect((await setup()).status).toBe(409);
  });
  it('rejects missing proof, hostile origins, public signup and oversized chunked bodies', async () => {
    expect(
      (
        await service.fetch(
          req('/api/bootstrap', {
            proof: 'a'.repeat(43),
            username: 'owner',
            password: 'a'.repeat(20),
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await service.fetch(
          new Request(origin + '/api/bootstrap', {
            method: 'POST',
            headers: { Origin: 'https://evil.example' },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(403);
    expect((await service.fetch(req('/api/auth/sign-up/email', {}))).status).toBe(401);
    expect((await service.fetch(req('/api/bootstrap', { huge: 'x'.repeat(9000) }))).status).toBe(
      413,
    );
    expect(db.prepare('SELECT * FROM "user"').get()).toBeUndefined();
  });
  it('keeps login across service restart, signs narrowly bound tickets, revokes logout', async () => {
    expect((await setup()).status).toBe(201);
    const cookie = await login();
    expect(cookie).toContain('__Secure-');
    service = createOwnerService(db, new NodeOwnerDatabase(db), settings);
    const response = await service.fetch(req('/api/hermes/ticket', {}, cookie));
    expect(response.status).toBe(200);
    const value = (await response.json()) as { ticket: string };
    const publicKey = { ...settings.signingKey };
    delete publicKey.d;
    const { payload } = await jwtVerify(
      value.ticket,
      await import('jose').then((m) => m.importJWK(publicKey, 'EdDSA')),
      { issuer: origin, audience: settings.installationId },
    );
    expect(payload.scope).toBe('workspace.owner');
    expect(payload.origin).toBe(origin);
    expect(payload.exp! - payload.iat!).toBe(300);
    expect((await service.fetch(req('/api/auth/sign-out', {}, cookie))).status).toBe(200);
    expect((await service.fetch(req('/api/hermes/ticket', {}, cookie))).status).toBe(401);
  });
  it('rolls back the claim if library account insertion fails', async () => {
    db.exec(
      "CREATE TRIGGER fail_account BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT,'fixture crash'); END;",
    );
    expect((await setup()).status).toBe(400);
    expect(db.prepare('SELECT * FROM owner_claim').get()).toBeUndefined();
    expect(db.prepare('SELECT * FROM "user"').get()).toBeUndefined();
    db.exec('DROP TRIGGER fail_account');
    expect((await setup()).status).toBe(201);
  });
  it('saves only fixed photo pixels, preserves them across login/restart, and removes them', async () => {
    await setup();
    const cookie = await login();
    const pixels = Buffer.from(
      Array.from({ length: OWNER_PHOTO_BYTES }, (_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256)),
    );
    pixels.fill(0, pixels.length - 4);
    const request = () => req('/api/owner/photo', { pixels: pixels.toString('base64') }, cookie);
    expect((await service.fetch(req('/api/owner/photo', { pixels: null }))).status).toBe(401);
    const saved = await service.fetch(request());
    expect(saved.status).toBe(200);
    const result = await saved.json();
    expect(result.image).toMatch(/^data:image\/png;base64,/);
    const png = Buffer.from(result.image.split(',')[1], 'base64');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([
      192, 192, 8, 6,
    ]);
    const idat = png.indexOf('IDAT');
    const scanlines = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    for (let row = 0; row < OWNER_PHOTO_SIDE; row++) {
      expect(scanlines[row * 769]).toBe(0);
      expect(scanlines.subarray(row * 769 + 1, (row + 1) * 769)).toEqual(
        pixels.subarray(row * 768, (row + 1) * 768),
      );
    }
    for (const body of [
      { pixels: 'data:image/svg+xml,<svg/>' },
      { pixels: pixels.toString('base64') + '=' },
      { pixels: null, image: 'https://remote.test/photo' },
    ])
      expect((await service.fetch(req('/api/owner/photo', body, cookie))).status).toBe(400);
    expect(
      (
        await service.fetch(
          req('/api/auth/update-user', { image: 'https://remote.test/photo' }, cookie),
        )
      ).status,
    ).toBe(404);
    const hostile = request();
    hostile.headers.set('Origin', 'https://hostile.test');
    expect((await service.fetch(hostile)).status).toBe(403);
    expect(
      (
        await service.fetch(
          req('/api/owner/photo', { pixels: 'x'.repeat(OWNER_PHOTO_BODY_LIMIT) }, cookie),
        )
      ).status,
    ).toBe(413);
    service = createOwnerService(db, new NodeOwnerDatabase(db), settings);
    const session = await (
      await service.fetch(req('/api/auth/get-session', undefined, cookie))
    ).json();
    expect(session.user.image).toBe(result.image);
    expect((await service.fetch(req('/api/auth/sign-out', {}, cookie))).status).toBe(200);
    expect((await service.fetch(request())).status).toBe(401);
    const freshCookie = await login();
    expect(
      (await (await service.fetch(req('/api/auth/get-session', undefined, freshCookie))).json())
        .user.image,
    ).toBe(result.image);
    expect(
      (await (await service.fetch(req('/api/owner/photo', { pixels: null }, freshCookie))).json())
        .image,
    ).toBeNull();
    expect(db.prepare('SELECT image FROM "user"').get()?.image).toBeNull();
  });
  it('does not save a photo when its owner session is revoked immediately before the write', async () => {
    await setup();
    const cookie = await login();
    const store = new NodeOwnerDatabase(db);
    service = createOwnerService(
      db,
      {
        first: store.first.bind(store),
        batch: async (statements) => {
          if (statements.some((s) => s.sql.startsWith('UPDATE "user" SET image=')))
            db.exec('DELETE FROM session');
          await store.batch(statements);
        },
      },
      settings,
    );
    const response = await service.fetch(
      req(
        '/api/owner/photo',
        { pixels: Buffer.alloc(OWNER_PHOTO_BYTES).toString('base64') },
        cookie,
      ),
    );
    expect(response.status).toBe(401);
    expect(db.prepare('SELECT image FROM "user"').get()?.image).toBeNull();
  });
});
