import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CameraOff, Captions, Mic, MicOff, PhoneOff } from 'lucide-react';
import { AtmeeCallDomain, ConversationDomain } from '@hermes-client/protocol';
import type { BridgeEvent, SessionClient } from '@hermes-client/protocol';
import type { ChatMessage } from '../conversation';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { IconButton } from '../components/ui/icon-button';
import { LoadingBar } from '../components/ui/loading-bar';
import { avatarMediaSource, playAvatar } from './avatar-playback';
import { voiceFailure } from './errors';
import { SpokenSession } from './spoken-session';

export type AtmeeCallHandle = { start: () => void; event: (event: BridgeEvent) => void };
type Ticket = Awaited<ReturnType<AtmeeCallDomain['start']>>;
type ActiveCall = {
  speech: SpokenSession;
  controller: AbortController;
  ticket?: Ticket;
  camera?: MediaStream;
  turns: Promise<void>;
  interrupt: Promise<unknown>;
  speaking: boolean;
  playing?: boolean;
};
type Utterance = { id: string; text: string; speechGeneration: number };

function cameraFrame(camera: HTMLVideoElement | null): string | null {
  if (!camera || camera.readyState < 2 || !camera.videoWidth || !camera.videoHeight) return null;
  const scale = Math.min(1, 360 / Math.max(camera.videoWidth, camera.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(camera.videoWidth * scale);
  canvas.height = Math.round(camera.videoHeight * scale);
  canvas.getContext('2d')?.drawImage(camera, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.65, 0.4, 0.2]) {
    const image = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    if (image && image.length <= 44_000) return image;
  }
  return null;
}

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
  onAccepted,
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
  onAccepted: (message: ChatMessage) => void;
}) {
  const active = useRef<ActiveCall | undefined>(undefined);
  const mounted = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const selfie = useRef<HTMLVideoElement>(null);
  const [inCall, setInCall] = useState(false);
  const [recognized, setRecognized] = useState(false);
  const [error, setError] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [camera, setCamera] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [caption, setCaption] = useState('');
  const [working, setWorking] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [videoRatio, setVideoRatio] = useState(1);
  const domain = new AtmeeCallDomain(client, sessionId);
  const ready = recognized && hasVideo;

  function stopCamera(call: ActiveCall) {
    for (const track of call.camera?.getTracks() ?? []) track.stop();
    delete call.camera;
    if (selfie.current) selfie.current.srcObject = null;
  }

  function close() {
    const call = active.current;
    if (!call) return;
    active.current = undefined;
    call.controller.abort();
    call.speech.close();
    stopCamera(call);
    if (call.ticket) void domain.end(call.ticket.id).catch(() => undefined);
    if (mounted.current) {
      setInCall(false);
      setRecognized(false);
      setCamera(false);
      setCameraBusy(false);
      setMuted(false);
      setWorking(false);
      setCaptions(false);
      setCaption('');
      setAudioBlocked(false);
      setHasVideo(false);
      setVideoRatio(1);
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

  useImperativeHandle(ref, () => ({
    start: () => void start(),
    event(event) {
      if (event.type === 'bridge.resync' && active.current) close();
    },
  }));

  async function turn(call: ActiveCall, request: Utterance, frame: string | null) {
    if (active.current !== call || !call.ticket) return;
    const id = call.ticket.id;
    const conversation = new ConversationDomain(client);
    setCaption(request.text);
    setWorking(true);
    let accepted = false;
    try {
      let result;
      try {
        result = await domain.submit(id, request.id, request.text, frame);
      } catch {
        result = await domain.status(id, request.id);
      }
      while (active.current === call) {
        if (!accepted && typeof result.user_row_id === 'number') {
          const user = await conversation
            .message(sessionId, String(result.user_row_id))
            .catch(() => undefined);
          if (active.current !== call) return;
          if (user) {
            accepted = true;
            onAccepted(user);
          }
        }
        if (result.state === 'silent') return;
        if (result.state === 'ready') {
          if (typeof result.assistant_row_id === 'number') {
            const reply = await conversation
              .message(sessionId, String(result.assistant_row_id))
              .catch(() => undefined);
            if (active.current !== call) return;
            if (reply?.text) setCaption(reply.text);
          }
          await call.interrupt;
          if (active.current !== call || !call.speech.canSpeak(request.speechGeneration)) return;
          call.speaking = true;
          try {
            const spoken = await domain.speak(id, request.id);
            if (spoken.started !== true) call.speaking = false;
          } catch {
            call.speaking = false;
            if (active.current === call)
              setError('The reply is in chat. The avatar couldn’t read it.');
          }
          return;
        }
        if (result.state !== 'pending') throw new Error('Spoken turn failed');
        await new Promise<void>((resolve) => setTimeout(resolve, 750));
        if (active.current !== call) return;
        result = await domain.status(id, request.id);
      }
    } catch {
      if (active.current === call)
        setError('Hermes couldn’t confirm the spoken reply. Check chat before repeating it.');
    } finally {
      if (active.current === call) setWorking(false);
    }
  }

  async function start() {
    if (active.current || blocked || !portal) return;
    setError('');
    const Source = avatarMediaSource();
    if (!Source) {
      setError('This browser doesn’t support video calls.');
      return;
    }
    const speech = new SpokenSession(
      {
        onStarted: () => {
          if (active.current === call) setRecognized(true);
        },
        onAudioLevel: () => undefined,
        onAutoplayBlocked: () => undefined,
        onClosed: (reason) => {
          if (active.current !== call) return;
          close();
          setError(reason);
        },
        onSpeechStart: () => {
          if (active.current !== call || !call.ticket || !call.speaking) return;
          call.speaking = false;
          call.interrupt = domain.interrupt(call.ticket.id).catch(() => undefined);
        },
        onPartial: (text) => {
          if (active.current === call && text) setCaption(text);
        },
        onUtterance: (request) => {
          if (active.current !== call) return;
          const frame = call.camera ? cameraFrame(selfie.current) : null;
          call.turns = call.turns.then(() => turn(call, request, frame));
        },
      },
      async () => {
        const ticket = await domain.start(botId);
        if (active.current !== call) {
          void domain.end(ticket.id).catch(() => undefined);
        } else {
          call.ticket = ticket;
          const element = video.current;
          if (!element) {
            close();
            throw new Error('Video element unavailable');
          }
          const signal = call.controller.signal;
          void playAvatar(
            element,
            Source,
            client.videoMedia(sessionId, ticket.id, signal),
            signal,
            () => {
              if (active.current === call) setAudioBlocked(true);
            },
          )
            .then(() => {
              if (active.current === call) {
                const hadVideo = call.playing;
                close();
                if (!hadVideo) setError('The Atmee video didn’t arrive. Try again.');
              }
            })
            .catch(() => {
              if (active.current === call) {
                close();
                setError('The Atmee video stopped. Try again.');
              }
            });
        }
        return { call_id: ticket.id.replaceAll('-', ''), token: ticket.transcriptionToken };
      },
    );
    const call: ActiveCall = {
      speech,
      controller: new AbortController(),
      turns: Promise.resolve(),
      interrupt: Promise.resolve(),
      speaking: false,
    };
    active.current = call;
    setInCall(true);
    onActive(true);
    try {
      const available = await domain.ready(botId);
      if (active.current !== call) return;
      if (!available) {
        close();
        onSetup();
        return;
      }
      await speech.start();
    } catch (cause) {
      if (active.current !== call) return;
      close();
      setError(voiceFailure(cause));
    }
  }

  async function toggleCamera() {
    const call = active.current;
    if (!call || !ready || cameraBusy) return;
    if (call.camera) {
      stopCamera(call);
      setCamera(false);
      return;
    }
    setCameraBusy(true);
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (active.current !== call || !selfie.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      call.camera = stream;
      selfie.current.srcObject = stream;
      setCamera(true);
      await selfie.current.play();
    } catch {
      if (active.current === call) {
        stopCamera(call);
        setCamera(false);
        setError('Camera access is unavailable.');
      }
    } finally {
      if (active.current === call) setCameraBusy(false);
    }
  }

  const portraitVideo = videoRatio < 1;
  const frameWidth = `min(100%, ${videoRatio * (portraitVideo ? 440 : 340)}px, calc(var(--app-viewport-height, 100dvh) * ${videoRatio * (portraitVideo ? 0.46 : 0.32)}))`;
  const panel =
    inCall || error ? (
      <section
        aria-label={`Video call with ${name}`}
        className="mx-auto grid w-full max-w-xl gap-2 px-4 pb-2"
      >
        {inCall && (
          <>
            <div
              className="relative isolate mx-auto overflow-hidden rounded-2xl bg-black"
              style={{ aspectRatio: videoRatio, width: frameWidth }}
            >
              <video
                ref={video}
                playsInline
                aria-label={`${name}’s video`}
                className="absolute inset-0 size-full object-contain"
                onPlaying={() => {
                  if (active.current) active.current.playing = true;
                  setHasVideo(true);
                }}
                onResize={(event) => {
                  const { videoWidth, videoHeight } = event.currentTarget;
                  if (videoWidth && videoHeight) setVideoRatio(videoWidth / videoHeight);
                }}
              />
              {!hasVideo && (
                <div className="pointer-events-none absolute inset-x-4 top-1/2 grid justify-items-center gap-2 text-sm text-white">
                  Waiting for video…
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
                disabled={!ready}
                onClick={() => {
                  active.current?.speech.setMuted(!muted);
                  setMuted(!muted);
                }}
              />
              <IconButton
                label={camera ? 'Turn camera off' : 'Turn camera on'}
                aria-description="Hermes sees one camera image when you finish speaking."
                icon={camera ? CameraOff : Camera}
                disabled={!ready || cameraBusy}
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
            {audioBlocked ? (
              <Button
                variant="secondary"
                className="justify-self-center"
                onClick={() => {
                  if (!video.current) return;
                  video.current.muted = false;
                  void video.current
                    .play()
                    .then(() => setAudioBlocked(false))
                    .catch(() => {
                      if (video.current) video.current.muted = true;
                    });
                }}
              >
                Enable sound
              </Button>
            ) : null}
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
  return portal && panel ? createPortal(panel, portal) : null;
}
