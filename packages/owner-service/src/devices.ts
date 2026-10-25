import { decodeJwt, importJWK, jwtVerify, SignJWT } from 'jose';
import type { OwnerDatabase, OwnerSettings } from './service';

const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const idPattern = /^[a-f0-9-]{36}$/;
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
type Device = {
  id: string;
  owner_id: string;
  credential_hash: string;
  invitation_hash: string;
  revoked: number;
};
export type DeviceBridgeGuard = {
  alive: () => Promise<boolean>;
  connected: () => Promise<void>;
};

export function createDeviceService(
  store: OwnerDatabase,
  settings: OwnerSettings,
  hash: (value: string) => Promise<string>,
  limited: (key: string, max: number, window: number) => Promise<boolean>,
) {
  async function active(id: string) {
    return store.first<Device>(
      `SELECT d.* FROM owner_device d JOIN owner_claim o ON o.user_id=d.owner_id WHERE d.id=? AND d.revoked=0`,
      [id],
    );
  }
  async function credential(request: Request) {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (!secretPattern.test(token)) return null;
    return store.first<Device>(
      `SELECT d.* FROM owner_device d JOIN owner_claim o ON o.user_id=d.owner_id WHERE d.credential_hash=? AND d.revoked=0`,
      [await hash(token)],
    );
  }
  return {
    async public(request: Request, ownerId: string): Promise<Response | null> {
      const path = new URL(request.url).pathname;
      if (!['/api/devices/redeem', '/api/devices/ticket', '/api/devices/disconnect'].includes(path))
        return null;
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (!(await limited('device:' + path, 60, 60)))
        return json({ error: 'Try again in a minute.' }, 429);
      if (path === '/api/devices/redeem') {
        const body = record(await request.json());
        if (
          !body ||
          Object.keys(body).sort().join(',') !== 'credential,id,invitation,name' ||
          typeof body.invitation !== 'string' ||
          !secretPattern.test(body.invitation) ||
          typeof body.credential !== 'string' ||
          !secretPattern.test(body.credential) ||
          typeof body.id !== 'string' ||
          !idPattern.test(body.id) ||
          typeof body.name !== 'string' ||
          !body.name.trim() ||
          body.name.length > 64
        )
          return json({ error: 'Invalid connection link.' }, 400);
        const invitationHash = await hash(body.invitation),
          credentialHash = await hash(body.credential);
        const now = Date.now();
        await store.batch([
          {
            sql: `INSERT OR IGNORE INTO owner_device(id,owner_id,name,credential_hash,invitation_hash,created,last_seen,revoked) SELECT ?,owner_id,?,?,?,?,?,0 FROM owner_device_invitation WHERE hash=? AND owner_id=? AND expires>?`,
            values: [
              body.id,
              body.name.trim(),
              credentialHash,
              invitationHash,
              now,
              now,
              invitationHash,
              ownerId,
              now,
            ],
          },
          {
            sql: `DELETE FROM owner_device_invitation WHERE hash=? AND EXISTS(SELECT 1 FROM owner_device WHERE id=? AND credential_hash=? AND invitation_hash=?)`,
            values: [invitationHash, body.id, credentialHash, invitationHash],
          },
        ]);
        const saved = await active(body.id);
        if (
          !saved ||
          saved.credential_hash !== credentialHash ||
          saved.invitation_hash !== invitationHash
        )
          return json(
            {
              error:
                'This code has expired or was already used. Create a new code in Add a device.',
            },
            410,
          );
        return json({ enrolled: true, id: saved.id }, 201);
      }
      const device = await credential(request);
      if (!device)
        return json(
          { error: 'This device no longer has access. Add it again in Pebble Crew settings.' },
          401,
        );
      if (path === '/api/devices/disconnect') {
        await store.batch([
          { sql: 'UPDATE owner_device SET revoked=1 WHERE id=?', values: [device.id] },
        ]);
        return json({ disconnected: true });
      }
      await store.batch([
        {
          sql: 'UPDATE owner_device SET last_seen=? WHERE id=? AND revoked=0',
          values: [Date.now(), device.id],
        },
      ]);
      const ticket = await new SignJWT({
        origin: settings.origin,
        scope: 'workspace.owner',
        sid: await hash('device:' + device.id),
        device_id: device.id,
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: settings.keyId, typ: 'JWT' })
        .setIssuer(settings.origin)
        .setAudience(settings.installationId)
        .setSubject(ownerId)
        .setJti(crypto.randomUUID())
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(await importJWK(settings.signingKey, 'EdDSA'));
      return json({ ticket, expiresIn: 300, bridgeUrl: settings.bridgeUrl });
    },
    async owner(request: Request, ownerId: string): Promise<Response | null> {
      const path = new URL(request.url).pathname;
      if (path === '/api/devices' && request.method === 'GET') {
        const row = await store.first<{ devices: string }>(
          `SELECT json_group_array(json_object('id',id,'name',name,'created',created,'lastSeen',last_seen)) AS devices FROM (SELECT d.* FROM owner_device d JOIN owner_device_connection c ON c.device_id=d.id WHERE d.owner_id=? AND d.revoked=0 ORDER BY d.created DESC)`,
          [ownerId],
        );
        const devices: unknown = JSON.parse(row?.devices ?? '[]');
        return json({ devices });
      }
      if (path === '/api/devices/invitation/status' && request.method === 'POST') {
        const body = record(await request.json());
        if (
          !body ||
          Object.keys(body).join(',') !== 'id' ||
          typeof body.id !== 'string' ||
          !/^[a-f0-9]{64}$/.test(body.id)
        )
          return json({ error: 'Invalid connection code.' }, 400);
        const device = await store.first<{
          name: string;
          revoked: number;
          connected: number | null;
        }>(
          'SELECT d.name,d.revoked,c.connected FROM owner_device d LEFT JOIN owner_device_connection c ON c.device_id=d.id WHERE d.invitation_hash=? AND d.owner_id=?',
          [body.id, ownerId],
        );
        if (device)
          return json({
            state: device.revoked
              ? 'revoked'
              : device.connected == null
                ? 'connecting'
                : 'connected',
            name: device.name,
          });
        const invitation = await store.first<{ expires: number }>(
          'SELECT expires FROM owner_device_invitation WHERE hash=? AND owner_id=?',
          [body.id, ownerId],
        );
        return json({
          state: invitation && invitation.expires > Date.now() ? 'pending' : 'expired',
        });
      }
      if (path === '/api/devices/invitation' && request.method === 'POST') {
        if (!(await limited('device-invitations:' + ownerId, 20, 60)))
          return json({ error: 'Try again in a minute.' }, 429);
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const invitation = btoa(String.fromCharCode(...bytes))
          .replaceAll('+', '-')
          .replaceAll('/', '_')
          .replaceAll('=', '');
        const expires = Date.now() + 5 * 60 * 1000;
        await store.batch([
          { sql: 'DELETE FROM owner_device_invitation WHERE expires<=?', values: [Date.now()] },
          {
            sql: 'INSERT INTO owner_device_invitation(hash,owner_id,expires) VALUES(?,?,?)',
            values: [await hash(invitation), ownerId, expires],
          },
        ]);
        return json(
          {
            id: await hash(invitation),
            link: `${settings.origin}/connect-device#invitation=${invitation}`,
            desktopLink: `pebblecrew://connect?origin=${encodeURIComponent(settings.origin)}#invitation=${invitation}`,
            expires,
          },
          201,
        );
      }
      if (path === '/api/devices/revoke' && request.method === 'POST') {
        const body = record(await request.json());
        if (
          !body ||
          Object.keys(body).join(',') !== 'id' ||
          typeof body.id !== 'string' ||
          !idPattern.test(body.id)
        )
          return json({ error: 'Choose a connected device.' }, 400);
        await store.batch([
          {
            sql: 'UPDATE owner_device SET revoked=1 WHERE id=? AND owner_id=?',
            values: [body.id, ownerId],
          },
        ]);
        return json({ revoked: true });
      }
      return null;
    },
    async bridge(token: string): Promise<DeviceBridgeGuard | null | false> {
      if (!token.includes('.')) return null;
      try {
        const claims = decodeJwt(token);
        if (!('device_id' in claims)) return null;
        const publicKey = { ...settings.signingKey };
        delete publicKey.d;
        const { payload } = await jwtVerify(token, await importJWK(publicKey, 'EdDSA'), {
          issuer: settings.origin,
          audience: settings.installationId,
          algorithms: ['EdDSA'],
        });
        const id = payload.device_id;
        if (
          typeof id !== 'string' ||
          !idPattern.test(id) ||
          payload.scope !== 'workspace.owner' ||
          payload.origin !== settings.origin ||
          payload.sid !== (await hash('device:' + id))
        )
          return false;
        const device = await active(id);
        if (!device || payload.sub !== device.owner_id) return false;
        return {
          alive: async () => !!(await active(id)),
          connected: async () => {
            await store.batch([
              {
                sql: 'INSERT OR IGNORE INTO owner_device_connection(device_id,connected) SELECT id,? FROM owner_device WHERE id=? AND revoked=0',
                values: [Date.now(), id],
              },
            ]);
          },
        };
      } catch {
        return false;
      }
    },
  };
}
