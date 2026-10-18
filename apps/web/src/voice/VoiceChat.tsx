import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { BotBridgeClient, BridgeEvent } from '@hermes-client/protocol';
import { Mic, MicOff, PhoneOff, Play, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { LoadingBar } from '../components/ui/loading-bar';
import { nativeMessages } from '../conversation';
import type { ChatMessage } from '../conversation';
import { record, settings as decodeSettings, sessionAnswer } from './decode';
import type { VoiceSettings } from './decode';
import { VoiceLiveSession } from './live-session';
import { DelegationReceipts, delegationPrompt } from './delegations';
import type { Completion } from './delegations';
import { SecretCard } from './SecretCard';

export type VoiceChatHandle = { open: () => void; event: (event: BridgeEvent) => void };
export const VoiceChat = forwardRef<
  VoiceChatHandle,
  {
    client: BotBridgeClient;
    sessionId: string;
    running: boolean;
    onAccepted: (message: ChatMessage) => void;
  }
>(function VoiceChat({ client, sessionId, running, onAccepted }, ref) {
  const panel = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false),
    [settings, setSettings] = useState<VoiceSettings>();
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'preview'>('idle');
  const [muted, setMuted] = useState(false),
    [blockedAudio, setBlockedAudio] = useState(false);
  const [changingKey, setChangingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const preferenceFlight = useRef(false);
  const [error, setError] = useState(''),
    [caption, setCaption] = useState('');
  const [secret, setSecret] = useState<{ id: string; label: string; prompt: string }>();
  const live = useRef<VoiceLiveSession | undefined>(undefined),
    generation = useRef(0),
    mounted = useRef(true);
  const receipts = useRef(new DelegationReceipts());
  const seenDelegations = useRef(new Set<string>());
  const active = useRef(false),
    queue = useRef<{ id: string; text: string; context: string }[]>([]);
  const busy = useRef(running);
  busy.current = running;
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rpc = async (operation: string, params: Record<string, unknown> = {}) => {
    const epoch = generation.current;
    const value = await client.invoke(operation, { session_id: sessionId, ...params });
    if (!mounted.current || epoch !== generation.current)
      throw new Error('Voice operation was closed.');
    return value;
  };
  async function updatePreferences(voice: string, pace: string) {
    if (preferenceFlight.current) return;
    preferenceFlight.current = true;
    setSaving(true);
    setError('');
    try {
      setSettings(decodeSettings(await rpc('voice.preferences', { voice, pace })));
    } catch {
      if (mounted.current) setError('Voice settings could not be saved.');
    } finally {
      preferenceFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  useEffect(() => {
    if (visible || secret)
      panel.current?.scrollIntoView({
        block: 'end',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
  }, [visible, settings, secret]);
  async function loadSettings() {
    const value = decodeSettings(await rpc('voice.status'));
    if (mounted.current) setSettings(value);
  }
  async function loadSecret() {
    const data = record(await rpc('secrets.pending'));
    const first = Array.isArray(data.requests) ? data.requests[0] : undefined;
    if (!first) {
      if (mounted.current) setSecret(undefined);
      return;
    }
    const row = record(first);
    if (
      typeof row.id === 'string' &&
      typeof row.label === 'string' &&
      typeof row.prompt === 'string' &&
      mounted.current
    )
      setSecret({ id: row.id, label: row.label, prompt: row.prompt });
  }
  function end() {
    generation.current++;
    clearTimeout(previewTimer.current);
    clearTimeout(setupTimer.current);
    const previous = live.current;
    live.current = undefined;
    previous?.close();
    queue.current = [];
    seenDelegations.current.clear();
    active.current = false;
    receipts.current = new DelegationReceipts();
    if (mounted.current) {
      setState('idle');
      setMuted(false);
      setCaption('');
      setBlockedAudio(false);
    }
  }
  async function finish(result: Completion) {
    const id = receipts.current.take(result),
      call = live.current,
      epoch = generation.current;
    if (!id || !call) return;
    try {
      if (result.kind === 'failed') {
        call.speak(id, 'That request failed. Please check the error in chat.');
        return;
      }
      const history = nativeMessages(record(await rpc('chat.history')).messages);
      if (generation.current !== epoch || live.current !== call) return;
      const reply = history.find(
        (message) => message.id === String(result.assistant) && message.role === 'assistant',
      );
      if (reply?.text) call.speak(id, reply.text);
      else call.think(id, 'The result is available in chat.');
    } catch {
      if (mounted.current) setError('The reply is in chat. Voice could not read it.');
    } finally {
      active.current = false;
    }
  }
  async function drain() {
    const call = live.current;
    if (!call?.connected || busy.current || active.current || !queue.current.length) return;
    const request = queue.current.shift();
    if (!request) return;
    active.current = true;
    const epoch = generation.current;
    try {
      const response = await rpc('voice.submit', { text: request.text, context: request.context });
      if (generation.current !== epoch || live.current !== call) return;
      const early = receipts.current.accept(request.id, response);
      call.think(request.id, 'The selected agent is handling your request.');
      const data = record(response);
      const history = nativeMessages(record(await rpc('chat.history')).messages);
      const user = history.find((message) => message.id === String(data.user_row_id));
      if (user && generation.current === epoch) onAccepted(user);
      if (early) await finish(early);
    } catch (cause) {
      if (generation.current === epoch && mounted.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The spoken request could not be confirmed. Check chat before repeating it.',
        );
        active.current = false;
      }
    }
  }
  useEffect(() => {
    if (!running) void drain();
  });
  useEffect(() => {
    mounted.current = true;
    if (client.supportsSecrets) void loadSecret().catch(() => undefined);
    const timer = setInterval(() => {
      void drain();
    }, 500);
    const pagehide = () => end();
    window.addEventListener('pagehide', pagehide);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener('pagehide', pagehide);
      end();
    };
    // The enclosing keyed component owns this client/session for its entire life.
  }, [client, sessionId]);
  useImperativeHandle(ref, () => ({
    open() {
      setVisible(true);
      setError('');
      void loadSettings().catch(() => setError('Voice settings could not be loaded.'));
    },
    event(event) {
      if (event.type === 'bridge.resync') {
        end();
        return;
      }
      if (event.session_id !== sessionId) return;
      if (event.type === 'voice.setup') {
        setVisible(true);
        void loadSettings().catch(() => setError('Voice settings could not be loaded.'));
      }
      if (event.type === 'secret.changed') void loadSecret().catch(() => undefined);
      const result = receipts.current.observe(event);
      if (result) void finish(result);
    },
  }));
  async function start(preview: boolean) {
    end();
    const epoch = generation.current;
    setError('');
    setState(preview ? 'preview' : 'starting');
    const call = new VoiceLiveSession(
      {
        onStarted() {
          if (generation.current !== epoch) return;
          clearTimeout(setupTimer.current);
          if (preview) {
            call.speak(null, 'Hello. This is how I sound. Ready when you are.');
            previewTimer.current = setTimeout(end, 9000);
          } else setState('live');
        },
        onDelegation(id, context) {
          if (preview || generation.current !== epoch) return;
          const prompt = delegationPrompt(context);
          if (!prompt.text) return;
          if (queue.current.length >= 4) {
            setError('Several requests are waiting. Let this work finish before adding more.');
            return;
          }
          if (active.current || busy.current)
            call.think(id, 'Your request is waiting for the current Hermes work to finish.');
          queue.current.push({ id, ...prompt });
          void drain();
        },
        onError() {
          if (generation.current === epoch) {
            setError('The voice provider reported an error. Your work remains in chat.');
            end();
          }
        },
        onClosed(reason) {
          if (generation.current !== epoch) return;
          end();
          if (reason !== 'close_requested')
            setError('Call ended. You can start another when ready.');
        },
        onTranscript(fragment) {
          if (generation.current === epoch)
            setCaption((text) => (text + fragment.text).slice(-180));
        },
        onAutoplayBlocked() {
          if (generation.current === epoch) setBlockedAudio(true);
        },
      },
      async (sdp, outputOnly) =>
        sessionAnswer(await rpc('voice.session', { sdp, preview: outputOnly })),
    );
    live.current = call;
    setupTimer.current = setTimeout(() => {
      if (generation.current === epoch) {
        end();
        setError(
          'The call could not connect. Check your microphone permission and provider access.',
        );
      }
    }, 45000);
    try {
      await call.start(preview);
    } catch {
      if (generation.current === epoch) {
        end();
        setError('Couldn’t start voice. Check microphone permission and OpenAI live access.');
      }
    }
  }
  const secretCard = secret && (
    <SecretCard
      key={secret.id}
      title="Secret requested"
      label={secret.label}
      description={secret.prompt}
      onSkip={() => {
        void rpc('secrets.respond', { id: secret.id, value: '' })
          .then(loadSecret)
          .catch(() => setError('This request is no longer available.'));
      }}
      onSubmit={async (value) => {
        await rpc('secrets.respond', { id: secret.id, value });
        await loadSecret();
      }}
    />
  );
  return (
    <>
      {secretCard}
      {visible && (
        <section ref={panel} className="pc-voice-card" aria-label="Voice chat">
          <header>
            <h3>Voice</h3>
            <Button
              type="button"
              variant="quiet"
              size="icon"
              aria-label="Close voice setup"
              onClick={() => {
                end();
                setVisible(false);
              }}
            >
              <X />
            </Button>
          </header>
          {!settings && !error && <LoadingBar active label="Loading voice settings" />}
          {settings?.supported === false && <p>This Hermes build doesn’t support live voice.</p>}
          {settings?.supported && (!settings.configured || changingKey) && (
            <SecretCard
              title="OpenAI API key"
              label="VOICE_TOOLS_OPENAI_KEY"
              description="Saved to this Pebble’s Hermes profile. Live voice uses your OpenAI account."
              onSkip={() =>
                settings?.supported && settings.configured
                  ? setChangingKey(false)
                  : setVisible(false)
              }
              onSubmit={async (value) => {
                const receipt = record(await rpc('voice.credential', { value }));
                if (receipt.saved !== true) throw new Error('Save not confirmed');
                setChangingKey(false);
                await loadSettings();
              }}
            />
          )}
          {settings?.supported && settings.configured && !changingKey && (
            <>
              <div className="pc-voice-options">
                <label>
                  Voice
                  <select
                    aria-label="Voice"
                    value={settings.voice}
                    disabled={state !== 'idle' || saving}
                    onChange={(event) => void updatePreferences(event.target.value, settings.pace)}
                  >
                    {!settings.voices.includes(settings.voice) && <option>{settings.voice}</option>}
                    {settings.voices.map((voice) => (
                      <option key={voice}>{voice}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Speaking pace
                  <select
                    aria-label="Speaking pace"
                    value={settings.pace}
                    disabled={state !== 'idle' || saving}
                    onChange={(event) => void updatePreferences(settings.voice, event.target.value)}
                  >
                    <option value="slower">Slower</option>
                    <option value="natural">Natural</option>
                    <option value="faster">Faster</option>
                  </select>
                </label>
              </div>
              {settings.canChangeKey && state === 'idle' && (
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  disabled={saving}
                  onClick={() => setChangingKey(true)}
                >
                  Change API key
                </Button>
              )}
              <p className="pc-voice-disclosure">
                Audio and recent chat context go directly to OpenAI. Calls and previews use your
                provider account.
              </p>
              {saving && <LoadingBar active label="Saving voice settings" />}
              {state === 'idle' ? (
                <div className="pc-voice-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={saving}
                    onClick={() => void start(true)}
                  >
                    <Play />
                    Preview
                  </Button>
                  <Button type="button" disabled={saving} onClick={() => void start(false)}>
                    <Mic />
                    Start call
                  </Button>
                </div>
              ) : (
                <div className="pc-voice-actions">
                  <span role="status">
                    {state === 'starting'
                      ? 'Connecting'
                      : state === 'preview'
                        ? 'Voice preview'
                        : muted
                          ? 'Muted'
                          : 'Live'}
                  </span>
                  {state === 'live' && (
                    <Button
                      type="button"
                      variant="quiet"
                      aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                      onClick={() => {
                        live.current?.setMuted(!muted);
                        setMuted(!muted);
                      }}
                    >
                      {muted ? <MicOff /> : <Mic />}
                    </Button>
                  )}
                  <Button type="button" variant="quiet" onClick={end}>
                    <PhoneOff />
                    End
                  </Button>
                </div>
              )}
              {blockedAudio && (
                <Button
                  type="button"
                  onClick={() => {
                    void live.current?.audio
                      .play()
                      .then(() => setBlockedAudio(false))
                      .catch(() => setError('Your browser blocked audio playback.'));
                  }}
                >
                  Enable audio
                </Button>
              )}
              {caption && <p className="pc-voice-caption">{caption}</p>}
            </>
          )}
          {error && (
            <p role="alert" className="pc-voice-error">
              {error}
            </p>
          )}
        </section>
      )}
    </>
  );
});
