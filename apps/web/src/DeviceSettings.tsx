import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { LoadingBar } from './components/ui/loading-bar';
import { Button } from './components/ui/button';
import { Dialog, DialogContent } from './components/ui/dialog';
import { DevicePairing, type DeviceInvitation } from './DevicePairing';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from './components/ui/item';
import { Notice } from './ui/primitives';
import { ownerRequest } from './owner-request';

type Device = { id: string; name: string; lastSeen: number };
function devices(value: unknown): Device[] {
  if (!value || typeof value !== 'object' || !('devices' in value) || !Array.isArray(value.devices))
    throw Error('Devices could not be loaded.');
  return value.devices.map((row: unknown) => {
    if (
      !row ||
      typeof row !== 'object' ||
      !('id' in row) ||
      typeof row.id !== 'string' ||
      !('name' in row) ||
      typeof row.name !== 'string' ||
      !('lastSeen' in row) ||
      typeof row.lastSeen !== 'number'
    )
      throw Error('Devices could not be loaded.');
    return { id: row.id, name: row.name, lastSeen: row.lastSeen };
  });
}
export function DeviceSettings() {
  const [rows, setRows] = useState<Device[]>([]);
  const [invitation, setInvitation] = useState<DeviceInvitation>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  async function load(signal?: AbortSignal) {
    const rows = devices(await ownerRequest('/api/devices', undefined, signal));
    if (!signal?.aborted) setRows(rows);
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Devices are unavailable. Update your combined Pebble Crew plugin to connect native apps.',
          );
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  async function add() {
    const attempt = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await ownerRequest('/api/devices/invitation', {});
      if (
        !value ||
        typeof value !== 'object' ||
        !('id' in value) ||
        typeof value.id !== 'string' ||
        !('link' in value) ||
        typeof value.link !== 'string' ||
        !('desktopLink' in value) ||
        typeof value.desktopLink !== 'string' ||
        !('expires' in value) ||
        typeof value.expires !== 'number'
      )
        throw Error('Could not create a connection code.');
      const image = await QRCode.toDataURL(value.link, {
        width: 280,
        margin: 4,
        errorCorrectionLevel: 'M',
      });
      if (attempt !== generation.current) return;
      setInvitation({
        id: value.id,
        link: value.link,
        desktopLink: value.desktopLink,
        expires: value.expires,
        image,
      });
      setNow(Date.now());
      setOpen(true);
    } catch (e) {
      if (attempt === generation.current)
        setError(e instanceof Error ? e.message : 'Could not create a connection code.');
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      await ownerRequest('/api/devices/revoke', { id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke this device.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Devices" className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Connected devices</h2>
          <p className="text-sm text-muted-foreground">
            Connect the Pebble Crew app on your phone or computer.
          </p>
        </div>
        <Button onClick={() => void add()} disabled={busy || loading}>
          Add a device
        </Button>
      </div>
      <LoadingBar active={loading} label="Loading devices" />
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {!loading && !error && !rows.length && (
        <p className="text-sm text-muted-foreground">No native apps connected yet.</p>
      )}
      {rows.map((row) => (
        <Item key={row.id} className="px-0">
          <ItemContent>
            <ItemTitle>{row.name}</ItemTitle>
            <ItemDescription>
              Last connected {new Date(row.lastSeen).toLocaleString()}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="outline" disabled={busy} onClick={() => void revoke(row.id)}>
              Revoke access
            </Button>
          </ItemActions>
        </Item>
      ))}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            generation.current++;
            setBusy(false);
            setInvitation(undefined);
            void load().catch(() => setError('Devices could not be refreshed.'));
          }
        }}
      >
        <DialogContent size="content">
          {invitation && (
            <DevicePairing
              key={invitation.id}
              invitation={invitation}
              now={now}
              busy={busy}
              onNewCode={() => void add()}
              onConnected={async (name, signal) => {
                const rows = devices(await ownerRequest('/api/devices', undefined, signal));
                if (signal.aborted) return;
                setRows(rows);
                generation.current++;
                setBusy(false);
                setOpen(false);
                setInvitation(undefined);
                setNotice(`${name} connected.`);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
