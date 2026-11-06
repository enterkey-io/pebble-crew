import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CameraOff, Captions, Mic, MicOff, PhoneOff, Video } from 'lucide-react';
import type { Room } from 'livekit-client';
import { AtmeeCallDomain, ConversationDomain } from '@hermes-client/protocol';
import type { AtmeeCaption, BridgeEvent, SessionClient } from '@hermes-client/protocol';
import { safeError } from '@hermes-client/core';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { IconButton } from '../components/ui/icon-button';
import { LoadingBar } from '../components/ui/loading-bar';
import { completion, DelegationReceipts } from './delegations';

export type AtmeeCallHandle = { event: (event: BridgeEvent) => void };

type Work = {
  receipts: DelegationReceipts;
  reply: (text: string) => void;
  timer?: ReturnType<typeof setTimeout>;
};
type ActiveCall = {
  room?: Room;
  id?: string;
  mic?: MediaStream;
  camera?: MediaStream;
  captions: Set<Promise<void>>;
  lastOwner?: AtmeeCaption & { at: number };
  work?: Work;
  lastLine?: string;
  // Closing stops new writes; existing captions get a brief drain.
  closing?: boolean;
};

type CallPhase = 'idle' | 'starting' | 'joining' | 'live' | 'reconnecting';

export function AtmeeCall({
  ref,
  client,
  sessionId,
  botId,
  name,
  blocked,
  portal,
  onActive,
  onSetup,
}: {
  ref: Ref<AtmeeCallHandle>;
  client: SessionClient;
  sessionId: string;
  botId: string;
  name: string;
  blocked: boolean;
  portal: HTMLElement | null;
  onActive: (active: boolean) => void;
  onSetup: () => void;
}) {
  const active = useRef<ActiveCall | undefined>(undefined);
  const mounted = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const selfie = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [error, setError] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [camera, setCamera] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [caption, setCaption] = useState('');
  const [working, setWorking] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const domain = new AtmeeCallDomain(client, sessionId);

  function stopCamera(call: ActiveCall) {
    call.camera?.getTracks().forEach((track) => track.stop());
    delete call.camera;
    if (selfie.current) selfie.current.srcObject = null;
  }

  function close() {
    const call = active.current;
    if (!call) return;
    active.current = undefined;
    call.closing = true;
    call.work?.reply('The call ended. Look for the result in chat.');
    stopCamera(call);
    call.mic?.getTracks().forEach((track) => track.stop());
    if (call.room) void call.room.disconnect().catch(() => undefined);
    if (call.id) {
      const id = call.id;
      void Promise.race([
        Promise.allSettled(call.captions),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ])
        .then(() => domain.end(id))
        .catch(() => {
          if (mounted.current && !active.current)
            setError('Couldn’t confirm the call ended in Hermes.');
        });
    }
    if (mounted.current) {
      setPhase('idle');
      setCamera(false);
      setCameraBusy(false);
      setMuted(false);
      setWorking(false);
      setCaption('');
      setAudioBlocked(false);
      setHasVideo(false);
    }
    onActive(false);
  }

  useEffect(() => {
    mounted.current = true;
    window.addEventListener('pagehide', close);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', close);
      close();
    };
  }, [client, sessionId]);

  async function finish(call: ActiveCall, result: NonNullable<ReturnType<typeof completion>>) {
    const work = call.work;
    if (!work?.receipts.take(result)) return;
    if (result.kind === 'failed') {
      work.reply('Hermes could not complete that request. Details are in chat.');
      return;
    }
    try {
      const message = await new ConversationDomain(client).message(
        sessionId,
        String(result.assistant),
      );
      work.reply(message?.text?.slice(0, 1500) || 'The result is in chat.');
    } catch {
      work.reply('The result is in chat.');
    }
  }
  useImperativeHandle(ref, () => ({
    event(event) {
      const call = active.current;
      if (event.type === 'bridge.resync' && call) {
        close();
        return;
      }
      if (!call?.work || event.session_id !== sessionId) return;
      const result = call.work.receipts.observe(event);
      if (result) void finish(call, result);
    },
  }));

  async function delegate(call: ActiveCall): Promise<string> {
    // A tool request can overtake the matching final speech stream.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.allSettled([...call.captions]);
    const line = call.lastOwner;
    if (active.current !== call || !line || !call.id || performance.now() - line.at > 20000)
      return 'No completed owner utterance was captured. Ask them to repeat the request.';
    if (call.work || call.lastLine === line.id)
      return 'Hermes already received this request. Its result will be in chat.';
    call.lastLine = line.id;
    setWorking(true);
    return new Promise((resolve) => {
      let waiting = true;
      const work: Work = {
        receipts: new DelegationReceipts(),
        reply(text) {
          clearTimeout(work.timer);
          if (call.work === work) delete call.work;
          if (active.current === call) setWorking(false);
          if (waiting) {
            waiting = false;
            resolve(text);
          } else if (active.current === call && call.room) {
            void call.room.localParticipant
              .sendText(JSON.stringify({ type: 'event', text, ttl_s: 60 }), { topic: 'atmee.app' })
              .catch(() => undefined);
          }
        },
      };
      call.work = work;
      work.timer = setTimeout(() => {
        waiting = false;
        resolve('Hermes is still working. The result will also be available in chat.');
      }, 23000);
      void domain.delegate(call.id!, line.id).then(
        (receipt) => {
          if (active.current !== call || call.work !== work) return;
          try {
            const early = work.receipts.accept(line.id, receipt);
            if (early) void finish(call, early);
          } catch {
            work.reply(
              'Hermes could not confirm a live reply for this request. Check the text chat.',
            );
          }
        },
        () => work.reply('Hermes could not confirm the request. Check the text chat.'),
      );
    });
  }

  async function start() {
    if (active.current || blocked) return;
    const call: ActiveCall = { captions: new Set() };
    active.current = call;
    setError('');
    setPhase('starting');
    onActive(true);
    let microphoneRequested = false;
    try {
      if (!(await domain.ready(botId))) {
        if (active.current === call) {
          close();
          onSetup();
        }
        return;
      }
      if (active.current !== call) return;
      microphoneRequested = true;
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (active.current !== call) {
        mic.getTracks().forEach((track) => track.stop());
        return;
      }
      call.mic = mic;
      const [{ Room, RoomEvent, Track }, ticket] = await Promise.all([
        import('livekit-client'),
        domain.start(botId).then((value) => {
          if (active.current !== call) void domain.end(value.id).catch(() => undefined);
          else call.id = value.id;
          return value;
        }),
      ]);
      if (active.current !== call) return;
      const room = new Room({ adaptiveStream: true });
      call.room = room;
      const agentIdentity = () =>
        Array.from(room.remoteParticipants.values()).find(
          (participant) => participant.isAgent && participant.attributes['lk.publish_on_behalf'],
        )?.attributes['lk.publish_on_behalf'] ??
        Array.from(room.remoteParticipants.values()).find(
          (participant) => participant.isAgent && participant.attributes['lk.agent.name'],
        )?.identity;
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (
          active.current !== call ||
          !participant.isAgent ||
          !participant.attributes['lk.publish_on_behalf']
        )
          return;
        const element = track.kind === Track.Kind.Video ? video.current : audio.current;
        if (element) track.attach(element);
        if (track.kind === Track.Kind.Video) setHasVideo(true);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach();
        if (active.current === call && track.kind === Track.Kind.Video) setHasVideo(false);
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (active.current === call) setAudioBlocked(!room.canPlaybackAudio);
      });
      room.on(RoomEvent.Reconnecting, () => {
        if (active.current === call) setPhase('reconnecting');
      });
      room.on(RoomEvent.Reconnected, () => {
        if (active.current === call) setPhase('live');
      });
      room.on(RoomEvent.Disconnected, () => {
        if (active.current === call) close();
      });
      room.registerTextStreamHandler('lk.transcription', (reader, participant) => {
        const speaker =
          participant.identity === room.localParticipant.identity
            ? 'owner'
            : participant.identity === agentIdentity()
              ? 'avatar'
              : undefined;
        if (!speaker || !call.id || call.closing) return;
        const id = call.id;
        const job = (async () => {
          let text = '';
          for await (const chunk of reader.withAbortSignal(AbortSignal.timeout(12000))) {
            text += chunk.slice(0, 2000 - text.length);
            if (text.length >= 2000) break;
          }
          text = text.trim();
          if (!text) return;
          const line: AtmeeCaption = { id: crypto.randomUUID(), speaker, text };
          await domain.caption(id, line);
          if (active.current !== call) return;
          if (speaker === 'owner') call.lastOwner = { ...line, at: performance.now() };
          setCaption(text);
        })();
        call.captions.add(job);
        void job
          .catch(() => {
            if (active.current === call) setError('Some call captions could not be saved.');
          })
          .finally(() => call.captions.delete(job));
      });
      room.registerRpcMethod('atmee.tool', async ({ callerIdentity, payload }) => {
        if (callerIdentity !== agentIdentity() || payload.length > 1024)
          return 'Unsupported request.';
        try {
          const request = JSON.parse(payload);
          if (request?.name === 'ask_pebble') return await delegate(call);
        } catch {
          return 'The request could not be read.';
        }
        return 'Unsupported request.';
      });
      setPhase('joining');
      await room.connect(ticket.url, ticket.token);
      if (active.current !== call) {
        await room.disconnect();
        return;
      }
      await room.localParticipant.publishTrack(mic.getAudioTracks()[0]!, {
        source: Track.Source.Microphone,
      });
      void room.startAudio().catch(() => setAudioBlocked(true));
      if (active.current === call) setPhase('live');
    } catch (cause) {
      if (active.current !== call) return;
      close();
      setError(
        microphoneRequested && !call.mic
          ? 'Allow microphone access to start a video call.'
          : safeError(cause).message,
      );
    }
  }

  async function toggleCamera() {
    const call = active.current;
    if (!call || cameraBusy) return;
    if (call.camera) {
      stopCamera(call);
      setCamera(false);
      return;
    }
    setCameraBusy(true);
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      if (active.current !== call) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      call.camera = stream;
      if (selfie.current) selfie.current.srcObject = stream;
      setCamera(true);
    } catch {
      if (active.current === call) setError('Camera access is unavailable.');
    } finally {
      if (active.current === call) setCameraBusy(false);
    }
  }

  useEffect(() => {
    if (camera) void selfie.current?.play().catch(() => undefined);
  }, [camera]);

  async function toggleMic() {
    const call = active.current;
    if (!call?.mic) return;
    const next = !muted;
    for (const track of call.mic.getAudioTracks()) track.enabled = !next;
    setMuted(next);
  }

  const panel =
    phase !== 'idle' || error ? (
      <section
        aria-label={`Video call with ${name}`}
        className="mx-auto grid w-full max-w-xl gap-2 px-4 pb-2"
      >
        {phase !== 'idle' && (
          <>
            <div className="relative isolate flex h-[min(32dvh,340px)] items-center justify-center overflow-hidden rounded-2xl bg-black">
              <video
                ref={video}
                playsInline
                autoPlay
                muted
                aria-label={`${name}’s video`}
                className="size-full object-contain"
              />
              <audio ref={audio} autoPlay />
              {!hasVideo && (
                <div className="pointer-events-none absolute inset-x-4 top-1/2 grid justify-items-center gap-2 text-sm text-white">
                  {phase === 'reconnecting' ? 'Reconnecting…' : 'Waiting for video…'}
                  <div className="w-20">
                    <LoadingBar active label="Connecting video" />
                  </div>
                </div>
              )}
              {captions && caption && (
                <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/75 p-2 pr-24 text-sm text-white">
                  {caption}
                </p>
              )}
              <video
                ref={selfie}
                muted
                playsInline
                autoPlay
                aria-label="Your camera preview"
                hidden={!camera}
                className="absolute right-3 bottom-3 aspect-[3/4] w-[25%] max-w-28 -scale-x-100 rounded-xl border border-white/20 bg-black object-cover shadow-md"
              />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <IconButton
                label={muted ? 'Unmute microphone' : 'Mute microphone'}
                icon={muted ? MicOff : Mic}
                disabled={phase !== 'live'}
                onClick={() => void toggleMic()}
              />
              <IconButton
                label={camera ? 'Turn camera off' : 'Turn camera on'}
                icon={camera ? CameraOff : Camera}
                disabled={phase !== 'live' || cameraBusy}
                onClick={() => void toggleCamera()}
              />
              <IconButton
                label={captions ? 'Hide captions' : 'Show captions'}
                icon={Captions}
                onClick={() => setCaptions(!captions)}
              />
              <IconButton
                label="End video call"
                icon={PhoneOff}
                variant="destructive"
                onClick={close}
              />
            </div>
            {working && (
              <p role="status" className="text-center text-xs text-muted-foreground">
                {name} is working
              </p>
            )}
            {audioBlocked && (
              <Button variant="secondary" onClick={() => void active.current?.room?.startAudio()}>
                Enable sound
              </Button>
            )}
          </>
        )}
        {error && (
          <Alert>
            <AlertDescription>
              {error}
              <Button variant="link" onClick={() => setError('')}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </section>
    ) : null;
  return (
    <>
      <IconButton
        quiet
        label="Start video call"
        icon={Video}
        disabled={blocked || phase !== 'idle'}
        onClick={() => void start()}
      />
      {portal && panel && createPortal(panel, portal)}
    </>
  );
}
