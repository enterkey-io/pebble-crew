import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { SessionClient, BridgeEvent } from '@hermes-client/protocol';

import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { LoadingBar } from '../components/ui/loading-bar';
import { VoicePanel } from './VoicePanel';
import { VoiceCallBar } from './VoiceCallBar';
import { choices } from './VoiceOptions';
import type { VoiceChoices } from './VoiceOptions';
import type { AudioActivityHandle } from '../components/ai-elements/audio-activity';
import { rejectedVoiceKey, voiceFailure } from './errors';
import { ConversationDomain, decodeVoiceCall } from '@hermes-client/protocol';
import type { VoiceCallRecord } from '@hermes-client/protocol';
import type { ChatMessage } from '../conversation';
import { record, settings as decodeSettings, sessionAnswer, voiceLabels } from './decode';
import type { VoiceProvider, VoiceSettings, VoiceSettingsRequest } from './decode';
import { VoiceLiveSession } from './live-session';
import type { VoiceLiveHandlers } from './live-session';
import { ElevenRealtimeSession, elevenSessionAnswer } from './eleven-session';
import { DelegationReceipts, delegationPrompt } from './delegations';
import type { Completion } from './delegations';

export type VoiceChatHandle = { open: () => void; event: (event: BridgeEvent) => void };
export const VoiceChat = forwardRef<
  VoiceChatHandle,
  {
    client: SessionClient;
    sessionId: string;
    running: boolean;
    inputBlocked?: boolean;
    onAccepted: (message: ChatMessage) => void;
    onCallEnded?: (call: VoiceCallRecord) => void;
    onOpenSettings?: (request: VoiceSettingsRequest) => void;
    settingsRequest?: VoiceSettingsRequest | undefined;
    requestResolved?: boolean;
    onCredentialConfirmed?: () => void;
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
    inputBlocked = false,
    onAccepted,
    onCallEnded,
    onOpenSettings,
    settingsRequest,
    requestResolved = false,
    onCredentialConfirmed,
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
  const [value, setValue] = useState<VoiceChoices>({ voice: 'marin' });
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
  const live = useRef<VoiceLiveSession | ElevenRealtimeSession | undefined>(undefined),
    generation = useRef(0),
    mounted = useRef(true);
  const startedCallId = useRef<string | null>(null);
  const receipts = useRef(new DelegationReceipts());
  const seenDelegations = useRef(new Set<string>());
  const active = useRef(false),
    queue = useRef<{ id: string; text: string; context: string }[]>([]);
  const busy = useRef(running);
  busy.current = running || inputBlocked;
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rpc = async (operation: string, params: Record<string, unknown> = {}) => {
    const epoch = generation.current;
    const value = await client.invoke(operation, { session_id: sessionId, ...params });
    if (!mounted.current || epoch !== generation.current)
      throw new Error('Voice operation was closed.');
    return value;
  };
  const provider = settings?.supported ? settings.provider : 'openai';
  async function savePreferences(
    complete: boolean,
    selection = value,
    selected: VoiceProvider = provider,
  ) {
    const next = decodeSettings(
      await rpc('voice.preferences', {
        ...selection,
        complete,
        ...(selected === 'elevenlabs' ? { provider: selected } : {}),
      }),
    );
    setSettings(next);
    return next;
  }
  function applySettings(next: VoiceSettings, requestKey = false) {
    setSettings(next);
    if (next.supported) {
      setValue(choices(next));
      setStep(requestKey ? 'replacement' : next.keyConfirmed ? 'settings' : 'key');
    }
    return next;
  }
  async function loadSettings(requestKey = false) {
    return applySettings(decodeSettings(await rpc('voice.status')), requestKey);
  }
  const [elevenLabels, setElevenLabels] = useState<Record<string, string>>({});
  const loadElevenVoices =
    mode === 'settings' &&
    settings?.supported &&
    settings.provider === 'elevenlabs' &&
    settings.keyConfirmed &&
    visible;
  useEffect(() => {
    setElevenLabels({});
    if (!loadElevenVoices) return;
    let active = true;
    void rpc('voice.voices')
      .then((value) => {
        if (!active) return;
        setElevenLabels(voiceLabels(record(value).voices));
      })
      .catch(() => {
        // Presets and the default voice remain available if the key cannot list voices.
      });
    return () => {
      active = false;
    };
  }, [loadElevenVoices, client, sessionId]);
  async function open() {
    if (inputBlocked && mode === 'chat') return;
    setVisible(true);
    if (mode === 'chat' && (state !== 'idle' || opening)) return;
    if (mode === 'settings') end();
    setError(
      !requestResolved &&
        (settingsRequest?.kind === 'failure' || settingsRequest?.kind === 'key-failure')
        ? settingsRequest.message
        : '',
    );
    setNotice('');
    setOpening(true);
    const epoch = generation.current;
    try {
      const value = await loadSettings(
        !requestResolved &&
          (settingsRequest?.kind === 'replace-key' || settingsRequest?.kind === 'key-failure'),
      );
      setOpening(false);
      if (mode === 'chat') {
        if (value.supported && value.configured && value.setupComplete)
          await start(false, choices(value), value.provider);
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
  function end(followUp = false) {
    generation.current++;
    clearTimeout(previewTimer.current);
    clearTimeout(setupTimer.current);
    const previous = live.current;
    live.current = undefined;
    const callId = startedCallId.current;
    startedCallId.current = null;
    if (previous && callId) {
      const transcript = followUp
        ? previous
            .contextWindow()
            .map(
              (fragment) => `${fragment.speaker === 'user' ? 'User' : agentName}: ${fragment.text}`,
            )
            .join('\n')
            .slice(-6000)
        : '';
      const epoch = generation.current;
      void client
        .invoke('voice.end', { session_id: sessionId, call_id: callId, transcript })
        .then((value) => {
          const result = record(value);
          const saved = decodeVoiceCall(result.call);
          if (saved) onCallEnded?.(saved);
          if (
            result.follow_up_unconfirmed === true &&
            mounted.current &&
            generation.current === epoch
          ) {
            setVisible(true);
            setError('The call was saved. Its text follow-up could not be confirmed.');
          }
        })
        .catch(() => {
          if (mounted.current && generation.current === epoch) {
            setVisible(true);
            setError('The call ended, but its history entry could not be confirmed.');
          }
        });
    }
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
    end(true);
    if (mode === 'chat' && state !== 'preview') setVisible(false);
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
      const reply = await new ConversationDomain(client).message(
        sessionId,
        String(result.assistant),
      );
      if (generation.current !== epoch || live.current !== call) return;
      if (reply?.text) call.speak(id, reply.text);
      else call.speak(id, 'The result is available in chat.');
    } catch {
      if (generation.current === epoch && live.current === call) {
        call.speak(id, 'The reply is in chat. Voice could not read it.');
        setError('The reply is in chat. Voice could not read it.');
      }
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
      const user = await new ConversationDomain(client).message(
        sessionId,
        String(data.user_row_id),
      );
      if (user && generation.current === epoch) onAccepted(user);
      if (early) await finish(early);
    } catch (cause) {
      if (generation.current === epoch && mounted.current) {
        call.speak(request.id, 'Hermes could not confirm the request. Please check chat.');
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
      const result = receipts.current.observe(event);
      if (result) void finish(result);
    },
  }));
  async function start(preview: boolean, selection = value, selected: VoiceProvider = provider) {
    if (inputBlocked && !preview) return;
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
    const handlers: VoiceLiveHandlers = {
      onAudioLevel(level) {
        if (generation.current !== epoch) return;
        audioActivity.current?.update(level);
        if (preview && !previewHeard && level > 0.03 && call.playing) {
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
          const voiceName =
            selected === 'elevenlabs'
              ? settings?.supported && Object.hasOwn(settings.labels, selection.voice)
                ? settings.labels[selection.voice]
                : Object.hasOwn(elevenLabels, selection.voice)
                  ? elevenLabels[selection.voice]
                  : 'selected ElevenLabs'
              : selection.voice.charAt(0).toUpperCase() + selection.voice.slice(1);
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
        } else {
          startedCallId.current ??= call.sessionId;
          setState('live');
        }
      },
      onDelegation(id, context, request) {
        if (preview || generation.current !== epoch) return;
        const prompt = delegationPrompt(context);
        const text = request ?? prompt.text;
        if (!text) return;
        if (queue.current.length >= 4) {
          if (selected === 'elevenlabs') call.speak(id, 'Several requests are still waiting.');
          setError('Several requests are waiting. Let this work finish before adding more.');
          return;
        }
        if (active.current || busy.current)
          call.think(id, 'Your request is waiting for the current Hermes work to finish.');
        queue.current.push({ id, context: prompt.context, text });
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
        if (reason !== 'close_requested') setError('Call ended. You can start another when ready.');
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
    };
    const call =
      selected === 'elevenlabs'
        ? new ElevenRealtimeSession(handlers, async (sampleOnly) => {
            await savePreferences(!sampleOnly, selection, selected);
            return elevenSessionAnswer(
              await rpc('voice.session', { provider: selected, preview: sampleOnly }),
            );
          })
        : new VoiceLiveSession(handlers, async (sdp, sampleOnly) => {
            await savePreferences(!sampleOnly, selection, selected);
            return sessionAnswer(await rpc('voice.session', { sdp, preview: sampleOnly }));
          });
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
  return (
    <>
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
          settings={
            settings?.supported && provider === 'elevenlabs'
              ? {
                  ...settings,
                  voices: [...new Set([...settings.voices, ...Object.keys(elevenLabels)])],
                  labels: { ...elevenLabels, ...settings.labels },
                }
              : settings
          }
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
            void live.current
              ?.resumeAudio()
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
            const receipt = record(
              await rpc('voice.credential', {
                value,
                ...(provider === 'elevenlabs' ? { provider } : {}),
              }),
            );
            if (receipt.saved !== true) throw new Error('Save not confirmed');
            await savePreferences(false);
            setStep('settings');
            onCredentialConfirmed?.();
          }}
          onUseSaved={() => {
            setSaving(true);
            setError('');
            void savePreferences(false)
              .then(() => {
                setStep('settings');
                onCredentialConfirmed?.();
              })
              .catch((cause) => setError(voiceFailure(cause)))
              .finally(() => setSaving(false));
          }}
          onProvider={(next) => {
            setSaving(true);
            setError('');
            setNotice('');
            void rpc('voice.provider', { provider: next })
              .then((value) => applySettings(decodeSettings(value)))
              .catch((cause) => setError(voiceFailure(cause)))
              .finally(() => setSaving(false));
          }}
          onImportVox={(file) => {
            if (file.size > 64 * 1024) {
              setError('Choose a Vox voice export smaller than 64 KB.');
              return;
            }
            setSaving(true);
            setError('');
            setNotice('');
            void file
              .text()
              .then(async (value) => {
                let presets: unknown;
                try {
                  presets = JSON.parse(value);
                } catch {
                  setError('This file isn’t a Vox voice export.');
                  return;
                }
                await rpc('voice.vox_import', { presets });
                await loadSettings();
                setNotice('Vox voices imported.');
              })
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
                    void live.current
                      ?.resumeAudio()
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
