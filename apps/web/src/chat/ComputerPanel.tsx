import { Button } from '../components/ui/button';
import { useEffect, useRef, useState } from 'react';
import type { SessionClient } from '@hermes-client/protocol';
import type RFB from '@novnc/novnc';
import { Notice } from '../ui/primitives';
import { Drawer } from './Drawer';
export type ComputerStatus = {
  supported?: boolean;
  installed?: boolean;
  running?: boolean;
  missing?: string[];
  blocker?: string;
  lease?: { holder: string; mine: boolean };
  placement?: string;
};
export function ComputerPanel({
  client,
  profile,
  name,
}: {
  client: SessionClient;
  profile: string;
  name: string;
}) {
  const [status, setStatus] = useState<ComputerStatus>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [stopping, setStopping] = useState(false);
  async function update() {
    try {
      setStatus((await client.invoke('computer.status', { profile })) as ComputerStatus);
    } catch {
      setError('Computer status could not be loaded.');
    }
  }
  useEffect(() => {
    let live = true;
    void client
      .invoke('computer.status', { profile })
      .then((v) => {
        if (live) setStatus(v as ComputerStatus);
      })
      .catch(() => {
        if (live) setError('Computer status could not be loaded.');
      });

    return () => {
      live = false;
    };
  }, [client, profile]);
  async function stop() {
    setBusy(true);
    setError('');
    try {
      setStatus((await client.invoke('computer.stop', { profile })) as ComputerStatus);
      setStopping(false);
    } catch {
      setError('Computer could not be stopped. Check its current state.');
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setError('');
    try {
      setStatus((await client.invoke('computer.start', { profile })) as ComputerStatus);
    } catch {
      setError('This Computer could not be started. Check the host’s Computer setup.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="computer-panel">
      {error && (
        <Notice error>
          {error}
          <Button variant="secondary" onClick={() => void update()}>
            Try again
          </Button>
        </Notice>
      )}
      {!status ? (
        <Notice>Checking Computer…</Notice>
      ) : !status.supported ? (
        <p className="empty-note">Computer is unavailable on this host.</p>
      ) : !status.installed ? (
        <>
          <p className="empty-note">
            Computer needs the native desktop packages on your Hermes host.
          </p>
          <p className="field-hint">
            Ask your Hermes agent to set up native Bot Screen for this host.
          </p>
        </>
      ) : (
        <>
          <p className="field-hint">
            {status.running ? 'Computer is running.' : 'Computer is stopped.'}
          </p>
          {status.blocker && <Notice>{status.blocker}</Notice>}
          <Button
            variant="secondary"
            disabled={busy || (!status.running && !!status.blocker)}
            onClick={() => (status.running ? setOpen(true) : void start())}
          >
            {busy ? 'Starting…' : status.running ? 'Open Computer' : 'Start Computer'}
          </Button>
          {status.running && (
            <Button variant="secondary" disabled={busy} onClick={() => setStopping(true)}>
              Stop Computer
            </Button>
          )}
        </>
      )}
      {stopping && (
        <Drawer title="Stop Computer" variant="dialog" onClose={() => setStopping(false)}>
          <h2>Stop {name}’s Computer?</h2>
          <p>Open desktop applications will close. Chat stays available.</p>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setStopping(false)}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void stop()}>
              Stop Computer
            </Button>
          </div>
        </Drawer>
      )}
      {open && (
        <Drawer
          title={`${name}’s Computer`}
          variant="dialog"
          onClose={() => {
            setOpen(false);
            void update();
          }}
        >
          <ComputerViewer client={client} profile={profile} name={name} />
        </Drawer>
      )}
    </div>
  );
}
function ComputerViewer({
  client,
  profile,
  name,
}: {
  client: SessionClient;
  profile: string;
  name: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    rfb = useRef<RFB | undefined>(undefined),
    socket = useRef<WebSocket | undefined>(undefined);
  const [status, setStatus] = useState<ComputerStatus>(),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(false),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false),
    [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (hidden) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setError('');
    setConnected(false);
    const read = async () => {
      try {
        const state = (await client.invoke('computer.status', { profile })) as ComputerStatus;
        if (live) {
          setStatus(state);
          if (rfb.current)
            rfb.current.viewOnly = !(state.lease?.holder === 'human' && state.lease.mine);
        }
      } catch {
        if (live) setError('Computer status is temporarily unavailable.');
      } finally {
        if (live) timer = setTimeout(() => void read(), 2500);
      }
    };
    void (async () => {
      try {
        const module = await import('@novnc/novnc');
        const result = (await client.invoke('computer.observe', { profile })) as { ticket: string };
        if (!live) return;
        const ws = client.computerSocket(result.ticket);
        socket.current = ws;
        const view = new module.default(host.current!, ws);
        rfb.current = view;
        view.viewOnly = true;
        view.scaleViewport = true;
        view.resizeSession = false;
        view.addEventListener('connect', () => {
          if (live) {
            setConnected(true);
            void read();
          }
        });
        view.addEventListener('disconnect', () => {
          if (live) {
            setConnected(false);
            setError('Computer connection ended. Reconnect to continue.');
          }
        });
        view.addEventListener('securityfailure', () => {
          if (live) setError('Computer access was denied.');
        });
      } catch {
        if (live) setError('Computer connection could not be opened.');
      }
    })();
    return () => {
      live = false;
      clearTimeout(timer);
      socket.current?.close(document.hidden ? 1011 : 1000);
      rfb.current?.disconnect();
      rfb.current = undefined;
      socket.current = undefined;
      host.current?.replaceChildren();
    };
  }, [client, profile, attempt, hidden]);
  async function control(action: 'control' | 'release' | 'force_release') {
    setBusy(true);
    setError('');
    try {
      await client.invoke(`computer.${action}`, { profile });
      const next = (await client.invoke('computer.status', { profile })) as ComputerStatus;
      setStatus(next);
      if (rfb.current) rfb.current.viewOnly = !(next.lease?.holder === 'human' && next.lease.mine);
    } catch {
      setError('Control could not be changed. Check the current holder before trying again.');
    } finally {
      setBusy(false);
    }
  }
  const human = status?.lease?.holder === 'human',
    mine = human && status?.lease?.mine;
  return (
    <section className="computer-viewer">
      <header>
        <h2>{name}’s Computer</h2>
        <span role="status">
          {!connected
            ? 'Connecting…'
            : mine
              ? 'You have control'
              : human
                ? 'Another viewer has control'
                : 'Watching'}
        </span>
      </header>
      <div className="computer-actions">
        <Button
          variant="secondary"
          disabled={!connected || busy}
          onClick={() => void control(mine ? 'release' : 'control')}
        >
          {mine ? 'Hand back' : 'Take control'}
        </Button>
        {human && !mine && (
          <Button variant="secondary" disabled={busy} onClick={() => void control('force_release')}>
            Hand back to pebble
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => setAttempt((x) => x + 1)}>
          Reconnect
        </Button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {hidden && <Notice>Screen paused while this tab is hidden.</Notice>}
      <div className="computer-screen" ref={host} aria-label={`${name} remote screen`} />
    </section>
  );
}
