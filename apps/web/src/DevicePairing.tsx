import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Spinner } from './components/ui/spinner';
import { Notice } from './ui/primitives';
import { ownerRequest } from './owner-request';

export type DeviceInvitation = {
  id: string;
  link: string;
  desktopLink: string;
  expires: number;
  image: string;
};

export function DevicePairing({
  invitation,
  now,
  busy,
  onNewCode,
  onConnected,
}: {
  invitation: DeviceInvitation;
  now: number;
  busy: boolean;
  onNewCode: () => void;
  onConnected: (name: string, signal: AbortSignal) => Promise<void>;
}) {
  const [phase, setPhase] = useState<'code' | 'connecting' | 'expired' | 'revoked'>('code');
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [notice, setNotice] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showLink) panel.current?.scrollTo({ top: 0 });
  }, [showLink]);
  const connected = useRef(onConnected);
  connected.current = onConnected;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const status = await ownerRequest(
          '/api/devices/invitation/status',
          { id: invitation.id },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!status || typeof status !== 'object' || !('state' in status)) throw Error();
        setNotice('');
        switch (status.state) {
          case 'pending':
            break;
          case 'connecting':
            setPhase('connecting');
            break;
          case 'connected':
            setPhase('connecting');
            await connected.current(
              'name' in status && typeof status.name === 'string' ? status.name : 'Device',
              controller.signal,
            );
            return;
          case 'expired':
            setPhase('expired');
            return;
          case 'revoked':
            setPhase('revoked');
            return;
          default:
            throw Error();
        }
      } catch {
        if (controller.signal.aborted) return;
        setNotice('Waiting for a connection update…');
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [invitation.id]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a device</DialogTitle>
        <DialogDescription>
          {phase === 'connecting'
            ? 'Your app is connecting to Hermes.'
            : 'On your phone, open Pebble Crew and tap Scan QR code.'}
        </DialogDescription>
      </DialogHeader>
      <div ref={panel} className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {phase === 'connecting' ? (
          <div
            role="status"
            aria-label="Connecting device"
            className="flex min-h-64 flex-col items-center justify-center gap-4 py-10"
          >
            <Spinner className="size-8" aria-hidden="true" />
            <p className="text-base font-medium">Connecting…</p>
          </div>
        ) : phase === 'code' && now < invitation.expires ? (
          <>
            <img
              className="mx-auto size-[240px] max-w-full shrink-0 rounded-lg"
              src={invitation.image}
              alt="Pebble Crew device connection QR code"
              width={280}
              height={280}
            />
            <p className="text-center text-sm text-muted-foreground">
              This code works once and expires in{' '}
              {Math.max(1, Math.ceil((invitation.expires - now) / 60000))} minutes.
            </p>
            <div className="flex flex-col items-start gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">Setting up the Mac you're using now?</p>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = invitation.desktopLink;
                }}
              >
                Connect Pebble Crew on this Mac
              </Button>
              <p className="text-sm text-muted-foreground">
                Opens the Pebble Crew app installed on this Mac.
              </p>
              <Button
                variant="ghost"
                aria-expanded={showLink}
                onClick={() => setShowLink(!showLink)}
              >
                Connect using a copied link
              </Button>
              {showLink && (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-muted-foreground">
                    Copy this link, then paste it into the Pebble Crew app on your Mac.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(invitation.desktopLink)
                        .then(() => setCopied(true))
                        .catch(() => setNotice('Your browser could not copy the Mac setup link.'));
                    }}
                  >
                    {copied ? 'Copied' : 'Copy Mac setup link'}
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <Notice>
            {phase === 'revoked'
              ? 'This connection was cancelled. Create a new code to connect.'
              : 'This code has expired. Create a new one to connect.'}
          </Notice>
        )}
        {notice && (
          <p role="status" className="text-center text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {phase !== 'connecting' && (
          <Button variant="ghost" disabled={busy} onClick={onNewCode}>
            Create a new code
          </Button>
        )}
      </div>
    </>
  );
}
