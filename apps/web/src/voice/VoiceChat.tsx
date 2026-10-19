import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { BotBridgeClient, BridgeEvent } from '@hermes-client/protocol';

import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { LoadingBar } from '../components/ui/loading-bar';
import { VoicePanel } from './VoicePanel';
import { VoiceCallBar } from './VoiceCallBar';
import { choices } from './VoiceOptions';
import type { VoiceChoices } from './VoiceOptions';
import type { AudioActivityHandle } from '../components/ai-elements/audio-activity';
import { rejectedVoiceKey, voiceFailure } from './errors';
import { ConversationDomain } from '@hermes-client/protocol';
import type { ChatMessage } from '../conversation';
import { record, settings as decodeSettings, sessionAnswer } from './decode';
import type { VoiceSettings, VoiceSettingsRequest } from './decode';
import { VoiceLiveSession } from './live-session';
import { DelegationReceipts, delegationPrompt } from './delegations';
import type { Completion } from './delegations';
import { SecretCard } from '../components/ai-elements/secret-card';

export type VoiceChatHandle = { open: () => void; event: (event: BridgeEvent) => void };
export const VoiceChat = forwardRef<
  VoiceChatHandle,
  {
    client: BotBridgeClient;
    sessionId: string;
    running: boolean;
    onAccepted: (message: ChatMessage) => void;
    onOpenSettings?: (request: VoiceSettingsRequest) => void;
    settingsRequest?: VoiceSettingsRequest | undefined;
    onReady?: (() => void) | undefined;
    onDismiss?: (() => void) | undefined;
    onActiveChange?: (active: boolean) => void;
    mode?: 'chat' | 'settings';
    externalCallActive?: boolean;
    barTarget?: HTMLElement | null;
    avatar?: ReactNode;
    agentName?: string;
  }
>(function VoiceChat(
  {
    client,
    sessionId,
    running,
    onAccepted,
    onOpenSettings,
    settingsRequest,
    onReady,
    onDismiss,
    onActiveChange,
    mode = 'chat',
    externalCallActive = false,
    barTarget,
    avatar,
    agentName = 'Pebble',
  },
  ref,
) {
  const panel = useRef<HTMLDivElement>(null);
  const audioActivity = useRef<AudioActivityHandle>(null);
  const [value, setValue] = useState<VoiceChoices>({ voice: 'marin', speed: 1 });
  const [step, setStep] = useState<'key' | 'replacement' | 'settings'>('key');
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState(false);
  const [visible, setVisible] = useState(false),
    [settings, setSettings] = useState<VoiceSettings>();
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'preview'>('idle');
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [muted, setMuted] = useState(false),
    [blockedAudio, setBlockedAudio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [captions, setCaptions] = useState<{ speaker: 'user' | 'assistant'; text: string }[]>([]);
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
  async function savePreferences(complete: boolean, selection = value) {
    const next = decodeSettings(await rpc('voice.preferences', { ...selection, complete }));
    setSettings(next);
    return next;
  }
  async function loadSettings(requestKey = false) {
    const value = decodeSettings(await rpc('voice.status'));
    if (mounted.current) {
      setSettings(value);
      if (value.supported) {
        setValue(choices(value));
        setStep(
          requestKey ? 'replacement' : value.configured && value.keyConfirmed ? 'settings' : 'key',
        );
      }
    }
    return value;
  }
  async function open() {
    setVisible(true);
    if (mode === 'chat' && (state !== 'idle' || opening)) return;
    if (mode === 'settings') end();
    setError(
      settingsRequest?.kind === 'failure' || settingsRequest?.kind === 'key-failure'
        ? settingsRequest.message
        : '',
    );
    setNotice('');
    setOpening(true);
    const epoch = generation.current;
    try {
      const value = await loadSettings(
        settingsRequest?.kind === 'replace-key' || settingsRequest?.kind === 'key-failure',
      );
      setOpening(false);
      if (mode === 'chat') {
        if (value.supported && value.configured && value.setupComplete)
          await start(false, choices(value));
        else {
          setVisible(false);
          onOpenSettings?.({ kind: 'start' });
        }
      }
    } catch (cause) {
      if (mounted.current && generation.current === epoch) {
        if (mode === 'chat') onOpenSettings?.({ kind: 'failure', message: voiceFailure(cause) });
        else setError(voiceFailure(cause));
      }
    } finally {
      if (mounted.current && generation.current === epoch) setOpening(false);
    }
  }
  useEffect(() => {
    if (mode === 'settings') void open();
  }, [mode, client, sessionId, settingsRequest]);
  useEffect(() => {
    onActiveChange?.(state !== 'idle');
    return () => onActiveChange?.(false);
  }, [state, onActiveChange]);
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
      setOpening(false);
      setState('idle');
      setPreviewPlaying(false);
      setMuted(false);
      setCaptions([]);
      setBlockedAudio(false);
    }
  }
  function stopCall() {
    const call = live.current;
    const transcript =
      call
        ?.contextWindow()
        .map((fragment) => `${fragment.speaker === 'user' ? 'User' : agentName}: ${fragment.text}`)
        .join('\n')
        .slice(-6000) ?? '';
    const callId = call?.sessionId;
    const followUp = state === 'live' && call?.connected && callId && transcript.trim();
    end();
    if (mode === 'chat' && state !== 'preview') setVisible(false);
    if (followUp)
      void client
        .invoke('voice.end', { session_id: sessionId, call_id: callId, transcript })
        .catch(() => {
          if (mounted.current) {
            setVisible(true);
            setError('The call ended, but its text follow-up could not be confirmed.');
          }
        });
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
      const { messages: history } = await new ConversationDomain(client).history(sessionId);
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
      const { messages: history } = await new ConversationDomain(client).history(sessionId);
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
    if (mode === 'chat' && client.supportsSecrets) void loadSecret().catch(() => undefined);
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
      void open();
    },
    event(event) {
      if (event.type === 'bridge.resync') {
        end();
        return;
      }
      if (event.session_id !== sessionId) return;
      if (event.type === 'voice.setup') {
        onOpenSettings?.({
          kind: event.payload?.replace_key === true ? 'replace-key' : 'settings',
        });
      }
      if (event.type === 'secret.changed') void loadSecret().catch(() => undefined);
      const result = receipts.current.observe(event);
      if (result) void finish(result);
    },
  }));
  async function start(preview: boolean, selection = value) {
    end();
    const epoch = generation.current;
    const reportFailure = (message: string, keyRejected = false) => {
      if (mode === 'chat') {
        setVisible(false);
        onOpenSettings?.({ kind: keyRejected ? 'key-failure' : 'failure', message });
      } else {
        if (keyRejected) setStep('replacement');
        setError(message);
      }
    };
    setError('');
    setNotice('');
    setState('starting');
    let previewHeard = false,
      playbackBlocked = false;
    const call = new VoiceLiveSession(
      {
        onAudioLevel(level) {
          if (generation.current !== epoch) return;
          audioActivity.current?.update(level);
          if (preview && !previewHeard && level > 0.03 && !call.audio.paused) {
            previewHeard = true;
            setPreviewPlaying(true);
            clearTimeout(previewTimer.current);
            previewTimer.current = setTimeout(end, 30000);
          }
        },
        onSpeakingChange(speaking) {
          if (!preview || generation.current !== epoch) return;
          if (!previewHeard) return;
          clearTimeout(previewTimer.current);
          previewTimer.current = setTimeout(end, speaking ? 30000 : 1500);
        },
        onStarted() {
          if (generation.current !== epoch) return;
          clearTimeout(setupTimer.current);
          if (preview) {
            setState('preview');
            const voiceName = selection.voice.charAt(0).toUpperCase() + selection.voice.slice(1);
            call.speak(null, `Hi, this is the ${voiceName} voice on Pebble Crew. How do I sound?`);
            previewTimer.current = setTimeout(
              () => {
                if (generation.current !== epoch) return;
                end();
                if (previewHeard) return;
                reportFailure(
                  playbackBlocked
                    ? 'Your browser blocked preview audio. Try Preview again and enable audio when prompted.'
                    : 'No preview audio arrived. Try again.',
                );
              },
              previewHeard ? 30000 : 15000,
            );
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
            setError('The voice provider ended the audio connection. Your work remains in chat.');
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
            setCaptions((previous) => {
              const last = previous.at(-1);
              if (last?.speaker === fragment.speaker)
                return [
                  ...previous.slice(0, -1),
                  { speaker: last.speaker, text: (last.text + fragment.text).slice(-4000) },
                ];
              return [...previous.slice(-39), { speaker: fragment.speaker, text: fragment.text }];
            });
        },
        onAutoplayBlocked() {
          if (generation.current === epoch) {
            playbackBlocked = true;
            setBlockedAudio(true);
          }
        },
      },
      async (sdp, sampleOnly) => {
        await savePreferences(!sampleOnly, selection);
        return sessionAnswer(await rpc('voice.session', { sdp, preview: sampleOnly }));
      },
    );
    live.current = call;
    setupTimer.current = setTimeout(() => {
      if (generation.current === epoch) {
        end();
        reportFailure(
          preview
            ? 'The voice preview timed out. Try again. Preview does not use your microphone.'
            : 'The voice connection timed out. Try again.',
        );
      }
    }, 45000);
    try {
      await call.start(preview);
    } catch (cause) {
      if (generation.current === epoch) {
        end();
        reportFailure(voiceFailure(cause, preview), rejectedVoiceKey(cause));
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
      {mode === 'chat' && visible && state === 'idle' && !opening && error && (
        <Alert>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {visible &&
        opening &&
        state === 'idle' &&
        !(settings?.supported && settings.setupComplete) && (
          <LoadingBar active label="Loading voice settings" />
        )}
      {mode === 'settings' && visible && !opening && (
        <VoicePanel
          panel={panel}
          settings={settings}
          value={value}
          onChange={setValue}
          step={step}
          busy={saving}
          error={error}
          previewDisabled={externalCallActive}
          previewState={
            state === 'starting' || (state === 'preview' && !previewPlaying)
              ? 'starting'
              : state === 'preview'
                ? 'playing'
                : 'idle'
          }
          activity={audioActivity}
          onStopPreview={end}
          startIntent={
            (settingsRequest?.kind === 'start' ||
              settingsRequest?.kind === 'failure' ||
              settingsRequest?.kind === 'key-failure') &&
            !!onReady
          }
          audioBlocked={blockedAudio}
          onEnableAudio={() => {
            void live.current?.audio
              .play()
              .then(() => setBlockedAudio(false))
              .catch(() => setError('Your browser blocked audio playback.'));
          }}
          onClose={() => {
            end();
            setVisible(false);
            onDismiss?.();
          }}
          onKey={async (value) => {
            setError('');
            setNotice('');
            const receipt = record(await rpc('voice.credential', { value }));
            if (receipt.saved !== true) throw new Error('Save not confirmed');
            await savePreferences(false);
            setStep('settings');
          }}
          onUseSaved={() => {
            setSaving(true);
            setError('');
            void savePreferences(false)
              .then(() => setStep('settings'))
              .catch((cause) => setError(voiceFailure(cause)))
              .finally(() => setSaving(false));
          }}
          onPreview={() => void start(true)}
          onStart={() => {
            setSaving(true);
            setError('');
            void savePreferences(true)
              .then(() => onReady?.())
              .catch((cause) => setError(voiceFailure(cause)))
              .finally(() => setSaving(false));
          }}
          onSave={() => {
            setSaving(true);
            setError('');
            setNotice('');
            void savePreferences(true)
              .then(() => setNotice('Saved.'))
              .catch((cause) => setError(voiceFailure(cause)))
              .finally(() => setSaving(false));
          }}
        />
      )}
      {mode === 'chat' &&
        visible &&
        (state !== 'idle' ||
          (opening && mode === 'chat' && settings?.supported && settings.setupComplete)) &&
        (() => {
          const content = (
            <div
              className="mx-auto grid w-full max-w-lg gap-2 px-3 pb-2"
              data-slot="voice-call-surface"
            >
              <VoiceCallBar
                state={state === 'idle' ? 'starting' : state}
                muted={muted}
                activity={audioActivity}
                avatar={avatar}
                transcript={showTranscript}
                onTranscript={() => setShowTranscript((value) => !value)}
                onEnd={stopCall}
                onMute={() => {
                  live.current?.setMuted(!muted);
                  setMuted(!muted);
                }}
                onSettings={() => {
                  if (onOpenSettings) onOpenSettings({ kind: 'settings' });
                  else end();
                }}
              />
              {blockedAudio && (
                <Button
                  variant="quiet"
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
              {showTranscript && (
                <div
                  role="region"
                  aria-label="Voice transcript"
                  className="max-h-36 overflow-y-auto rounded-lg bg-muted/50 px-3 py-2 text-sm"
                >
                  {captions.length ? (
                    captions.map((caption, index) => (
                      <p key={index} className="mb-1 last:mb-0">
                        <span className="mr-2 text-xs text-muted-foreground">
                          {caption.speaker === 'user' ? 'You' : agentName}
                        </span>
                        {caption.text}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Your conversation will appear here.
                    </p>
                  )}
                </div>
              )}
              {error && (
                <Alert>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          );
          return barTarget ? createPortal(content, barTarget) : content;
        })()}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </>
  );
});
