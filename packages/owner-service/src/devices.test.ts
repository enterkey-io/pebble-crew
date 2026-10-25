import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { exportJWK, generateKeyPair } from 'jose';
import { createOwnerService, digest, type OwnerSettings } from './service';
import { NodeOwnerDatabase } from './node-store';

describe('native owner device access', () => {
  const origin = 'https://owner.example';
  let db: DatabaseSync;
  let settings: OwnerSettings;
  let service: ReturnType<typeof createOwnerService>;
  let cookie: string;
  function req(path: string, body?: unknown, auth?: { cookie?: string; token?: string }) {
    return new Request(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(auth?.cookie ? { Cookie: auth.cookie } : {}),
        ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function invitation() {
    const response = await service.fetch(req('/api/devices/invitation', {}, { cookie }));
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('link' in body) || typeof body.link !== 'string')
      throw Error('Missing invitation');
    return new URLSearchParams(new URL(body.link).hash.slice(1)).get('invitation')!;
  }
  function enrollment(code: string) {
    return {
      invitation: code,
      id: crypto.randomUUID(),
      credential: 'D'.repeat(43),
      name: 'iPhone',
    };
  }
  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(readFileSync('apps/owner-worker/migrations/0001_owner.sql', 'utf8'));
    db.exec(readFileSync('packages/owner-service/src/schema.sql', 'utf8'));
    const pair = await generateKeyPair('EdDSA', { extractable: true });
    settings = {
      origin,
      bridgeUrl: origin,
      nativeDevices: true,
      installationId: crypto.randomUUID(),
      keyId: 'owner-key',
      authSecret: 'private-test-secret'.repeat(4),
      signingKey: await exportJWK(pair.privateKey),
    };
    const proof = 'P'.repeat(43);
    db.prepare('INSERT INTO owner_setup VALUES(1,?,?)').run(
      await digest(proof),
      Date.now() + 60000,
    );
    service = createOwnerService(db, new NodeOwnerDatabase(db), settings);
    expect(
      (
        await service.fetch(
          req('/api/bootstrap', {
            proof,
            username: 'owner',
            password: 'isolated-test-password-123',
          }),
        )
      ).status,
    ).toBe(201);
    const login = await service.fetch(
      req('/api/auth/sign-in/username', {
        username: 'owner',
        password: 'isolated-test-password-123',
      }),
    );
    cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  });
  afterEach(() => db.close());

  it('requires owner login to create, list, and revoke devices', async () => {
    expect((await service.fetch(req('/api/devices/invitation', {}))).status).toBe(401);
    expect((await service.fetch(req('/api/devices'))).status).toBe(401);
    expect(
      (await service.fetch(req('/api/devices/revoke', { id: crypto.randomUUID() }))).status,
    ).toBe(401);
    expect(
      (
        await service.fetch(
          new Request(origin + '/api/devices/invitation', {
            method: 'POST',
            headers: { Origin: 'https://evil.example', Cookie: cookie },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(403);
  });
  it('consumes an invitation once and safely recovers a lost enrollment response', async () => {
    const code = await invitation(),
      body = enrollment(code);
    const responses = await Promise.all([
      service.fetch(req('/api/devices/redeem', body)),
      service.fetch(
        req('/api/devices/redeem', {
          ...body,
          id: crypto.randomUUID(),
          credential: 'E'.repeat(43),
        }),
      ),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 410]);
    expect((await service.fetch(req('/api/devices/redeem', body))).status).toBe(201);
    expect(db.prepare('SELECT count(*) n FROM owner_device').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) n FROM owner_device_invitation').get()?.n).toBe(0);
    expect(db.prepare('SELECT credential_hash FROM owner_device').get()?.credential_hash).toBe(
      await digest(body.credential),
    );
    expect(JSON.stringify(db.prepare('SELECT * FROM owner_device').get())).not.toContain(
      body.credential,
    );
  });
  it('rejects expired invitations and does not allow a revoked enrollment to return', async () => {
    const code = await invitation();
    db.exec('UPDATE owner_device_invitation SET expires=0');
    expect((await service.fetch(req('/api/devices/redeem', enrollment(code)))).status).toBe(410);
    const body = enrollment(await invitation());
    expect((await service.fetch(req('/api/devices/redeem', body))).status).toBe(201);
    await service.fetch(req('/api/devices/revoke', { id: body.id }, { cookie }));
    expect((await service.fetch(req('/api/devices/redeem', body))).status).toBe(410);
  });
  it('retains device access through service restart and revokes outstanding tickets independently', async () => {
    const first = enrollment(await invitation());
    await service.fetch(req('/api/devices/redeem', first));
    const second = { ...enrollment(await invitation()), credential: 'E'.repeat(43), name: 'Mac' };
    await service.fetch(req('/api/devices/redeem', second));
    service = createOwnerService(db, new NodeOwnerDatabase(db), settings);
    const ticketResponse = await service.fetch(
      req('/api/devices/ticket', {}, { token: first.credential }),
    );
    expect(ticketResponse.status).toBe(200);
    const ticketBody: unknown = await ticketResponse.json();
    if (
      !ticketBody ||
      typeof ticketBody !== 'object' ||
      !('ticket' in ticketBody) ||
      typeof ticketBody.ticket !== 'string'
    )
      throw Error('Missing ticket');
    const guard = await service.bridgeDevice(ticketBody.ticket);
    expect(guard).toBeTruthy();
    if (!guard) throw Error('Missing device guard');
    expect(await guard.alive()).toBe(true);
    expect(
      (await service.fetch(req('/api/devices/revoke', { id: first.id }, { cookie }))).status,
    ).toBe(200);
    expect(await guard.alive()).toBe(false);
    expect(await service.bridgeDevice(ticketBody.ticket)).toBe(false);
    expect(
      (await service.fetch(req('/api/devices/ticket', {}, { token: first.credential }))).status,
    ).toBe(401);
    const secondTicket = await service.fetch(
      req('/api/devices/ticket', {}, { token: second.credential }),
    );
    expect(secondTicket.status).toBe(200);
    const secondBody: unknown = await secondTicket.json();
    if (
      !secondBody ||
      typeof secondBody !== 'object' ||
      !('ticket' in secondBody) ||
      typeof secondBody.ticket !== 'string'
    )
      throw Error('Missing ticket');
    const secondGuard = await service.bridgeDevice(secondBody.ticket);
    if (!secondGuard) throw Error('Missing device guard');
    await secondGuard.connected();
    expect(
      await (await service.fetch(req('/api/devices', undefined, { cookie }))).json(),
    ).toMatchObject({ devices: [{ id: second.id, name: 'Mac' }] });
  });
  it('disconnects its own device without access to owner administration', async () => {
    const body = enrollment(await invitation());
    await service.fetch(req('/api/devices/redeem', body));
    expect(
      (await service.fetch(req('/api/devices/invitation', {}, { token: body.credential }))).status,
    ).toBe(401);
    expect(
      (await service.fetch(req('/api/devices/disconnect', {}, { token: body.credential }))).status,
    ).toBe(200);
    expect(
      (await service.fetch(req('/api/devices/ticket', {}, { token: body.credential }))).status,
    ).toBe(401);
  });
  it('reports connecting after redemption and lists the device only after a successful bridge connection', async () => {
    const code = await invitation(),
      id = await digest(code),
      body = enrollment(code);
    const status = () => service.fetch(req('/api/devices/invitation/status', { id }, { cookie }));
    expect(await (await status()).json()).toEqual({ state: 'pending' });
    expect((await service.fetch(req('/api/devices/invitation/status', { id }))).status).toBe(401);
    await service.fetch(req('/api/devices/redeem', body));
    expect(await (await status()).json()).toEqual({ state: 'connecting', name: 'iPhone' });
    expect(await (await service.fetch(req('/api/devices', undefined, { cookie }))).json()).toEqual({
      devices: [],
    });
    const response = await service.fetch(
      req('/api/devices/ticket', {}, { token: body.credential }),
    );
    const ticket: unknown = await response.json();
    if (
      !ticket ||
      typeof ticket !== 'object' ||
      !('ticket' in ticket) ||
      typeof ticket.ticket !== 'string'
    )
      throw Error('Missing ticket');
    expect(await (await status()).json()).toMatchObject({ state: 'connecting' });
    const guard = await service.bridgeDevice(ticket.ticket);
    if (!guard) throw Error('Missing device guard');
    await guard.connected();
    expect(await (await status()).json()).toEqual({ state: 'connected', name: 'iPhone' });
    expect(
      await (await service.fetch(req('/api/devices', undefined, { cookie }))).json(),
    ).toMatchObject({ devices: [{ id: body.id, name: 'iPhone' }] });
  });
});
