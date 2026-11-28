import { createPortal } from 'react-dom';
import { ClientError } from '@hermes-client/core';
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
import { decodeVoiceCall } from '@hermes-client/protocol';
import type { VoiceCallRecord } from '@hermes-client/protocol';
import {
  providerNames,
  record,
  settings as decodeSettings,
  sessionAnswer,
  voiceLabels,
} from './decode';
import type { VoiceProvider, VoiceSettings, VoiceSettingsRequest } from './decode';
import { VoiceLiveSession } from './live-session';
import type { VoiceLiveHandlers } from './live-session';
import { SpokenSession, setAudioSession } from './spoken-session';
import { GrokSession } from './grok-session';
import { delegationPrompt } from './delegations';

export type VoiceChatHandle = { open: () => void; event: (event: BridgeEvent) => void };
export const VoiceChat = forwardRef<
  VoiceChatHandle,
  {
    client: SessionClient;
    sessionId: string;
    running: boolean;
    inputBlocked?: boolean;
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
  const live = useRef<VoiceLiveSession | SpokenSession | GrokSession | undefined>(undefined),
    /** The bridge's call ID for a GPT-Live call (Grok and ElevenLabs carry their own). */
    liveCall = useRef<string | null>(null),
    generation = useRef(0),
    mounted = useRef(true);
  const sampleContext = useRef<AudioContext | undefined>(undefined);
  const sampleFrame = useRef(0);
  const [partialCaption, setPartialCaption] = useState('');
  const active = useRef(false);
  /** A spoken turn for the Pebble. Live providers carry the request that answers it. */
  const queue = useRef<
    {
      id: string;
      text: string;
      speechGeneration?: number;
      delegationId?: string;
      toolCallId?: string;
    }[]
  >([]);
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
        ...(selected !== 'openai' ? { provider: selected } : {}),
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
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'key' | 'error'>(
    'loading',
  );
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const loadElevenVoices =
    mode === 'settings' &&
    step === 'settings' &&
    settings?.supported &&
    settings.provider === 'elevenlabs' &&
    settings.keyConfirmed &&
    visible;
  useEffect(() => {
    setElevenLabels({});
    setCatalogState('loading');
    if (!loadElevenVoices) return;
    let active = true;
    void rpc('voice.voices')
      .then((value) => {
        if (!active) return;
        setElevenLabels(voiceLabels(record(record(value).voices)));
        setCatalogState('ready');
      })
      .catch((cause) => {
        if (!active) return;
        setCatalogState(
          cause instanceof ClientError &&
            ['ELEVEN_KEY_REJECTED', 'ELEVEN_ACCESS_DENIED'].includes(cause.code)
            ? 'key'
            : 'error',
        );
      });
    return () => {
      active = false;
    };
  }, [loadElevenVoices, client, sessionId, catalogAttempt]);
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
    cancelAnimationFrame(sampleFrame.current);
    const sample = sampleContext.current;
    sampleContext.current = undefined;
    if (sample && sample.state !== 'closed') {
      void sample.close().catch(() => undefined);
      setAudioSession('auto');
    }
    const previous = live.current;
    live.current = undefined;
    const callId =
      previous instanceof SpokenSession || previous instanceof GrokSession
        ? previous.sessionId
        : previous instanceof VoiceLiveSession
          ? liveCall.current
          : null;
    liveCall.current = null;
    if (callId) {
      const epoch = generation.current;
      void client
        .invoke('voice.end', { session_id: sessionId, call_id: callId, follow_up: followUp })
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
            setError('The call was saved. Its follow-up could not be confirmed.');
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
    active.current = false;
    if (mounted.current) {
      setOpening(false);
      setState('idle');
      setPreviewPlaying(false);
      setMuted(false);
      setCaptions([]);
      setPartialCaption('');
      setBlockedAudio(false);
    }
  }
  function stopCall() {
    end(true);
    if (mode === 'chat' && state !== 'preview') setVisible(false);
  }
  async function drain() {
    const call = live.current;
    const callId =
      call instanceof SpokenSession || call instanceof GrokSession
        ? call.sessionId
        : call instanceof VoiceLiveSession
          ? liveCall.current
          : null;
    if (
      !call ||
      !callId ||
      !call.connected ||
      busy.current ||
      active.current ||
      !queue.current.length
    )
      return;
    const request = queue.current.shift();
    if (!request) return;
    active.current = true;
    const epoch = generation.current;
    const params = { call_id: callId, utterance_id: request.id };
    // A live provider is waiting on this request; it always gets an answer.
    const answerLive = (text: string) => {
      if (call instanceof GrokSession && request.toolCallId) call.answer(request.toolCallId, text);
      if (call instanceof VoiceLiveSession && request.delegationId)
        call.speak(request.delegationId, text);
    };
    try {
      let result;
      try {
        result = record(await rpc('voice.submit', { ...params, text: request.text }));
      } catch {
        // A lost response is reconciled by ID. Do not submit another Hermes turn.
        result = record(await rpc('voice.turn', params));
      }
      const deadline = Date.now() + 15 * 60 * 1000;
      for (;;) {
        if (generation.current !== epoch) return;
        if (result.state === 'ready') {
          try {
            // Call rows are hidden from chat, so the server sends the reply text for
            // captions. Looking the row up in history would walk the whole history.
            if (typeof result.assistant_text === 'string' && result.assistant_text.trim()) {
              const text = result.assistant_text.slice(0, 6000);
              setCaptions((previous) => [...previous.slice(-39), { speaker: 'assistant', text }]);
            }
            if (call instanceof SpokenSession)
              await call.speak(request.speechGeneration ?? -1, (signal) =>
                client.voiceAudio(sessionId, callId, request.id, signal),
              );
            else
              answerLive(
                typeof result.assistant_text === 'string' && result.assistant_text.trim()
                  ? result.assistant_text
                  : 'The answer is in the chat, but it could not be read here. Say so briefly.',
              );
          } catch {
            if (generation.current === epoch)
              setError('The reply is in chat. Voice could not read it.');
          }
          return;
        }
        if (result.state === 'silent') {
          answerLive('There was no reply to share. Say so briefly.');
          return;
        }
        if (result.state === 'failed') {
          answerLive('That request failed. Say so briefly; details are in the chat.');
          setError('Hermes could not finish this turn. Check chat for details.');
          return;
        }
        if (result.state !== 'pending' || Date.now() >= deadline)
          throw new Error(
            'Hermes could not confirm the spoken reply. Check chat before repeating it.',
          );
        await new Promise<void>((resolve) => setTimeout(resolve, 750));
        if (generation.current !== epoch) return;
        result = record(await rpc('voice.turn', params));
      }
    } catch {
      answerLive('The request could not be confirmed. Ask the owner to check the chat.');
      if (generation.current === epoch && mounted.current)
        setError('Hermes could not confirm the spoken reply. Check chat before repeating it.');
    } finally {
      if (generation.current === epoch) active.current = false;
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
      if (event.type === 'bridge.resync') return;
      if (event.session_id !== sessionId) return;
      if (event.type === 'voice.setup') {
        onOpenSettings?.({
          kind: event.payload?.replace_key === true ? 'replace-key' : 'settings',
        });
      }
    },
  }));
  async function playElevenSample(voice: string, epoch: number) {
    // Plays through the iPhone silent switch, like a media app.
    setAudioSession('playback');
    const context = new AudioContext();
    sampleContext.current = context;
    void context.resume().catch(() => undefined);
    const data = record(await rpc('voice.sample', { voice }));
    if (typeof data.audio !== 'string' || !data.audio || data.audio.length > 11_184_812)
      throw new ClientError('ELEVEN_SAMPLE_UNAVAILABLE');
    const bytes = Uint8Array.from(atob(data.audio), (byte) => byte.charCodeAt(0));
    const buffer = await context.decodeAudioData(bytes.buffer);
    if (generation.current !== epoch) return;
    const source = context.createBufferSource();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.buffer = buffer;
    source.connect(analyser);
    analyser.connect(context.destination);
    source.onended = () => {
      if (generation.current === epoch) end();
    };
    const wave = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (generation.current !== epoch) return;
      analyser.getByteTimeDomainData(wave);
      let peak = 0;
      for (const byte of wave) peak = Math.max(peak, Math.abs(byte - 128));
      audioActivity.current?.update(peak / 128);
      sampleFrame.current = requestAnimationFrame(tick);
    };
    setState('preview');
    const syncAudio = () => {
      if (generation.current !== epoch) return;
      setPreviewPlaying(context.state === 'running');
      setBlockedAudio(context.state !== 'running');
    };
    context.onstatechange = syncAudio;
    syncAudio();
    source.start();
    tick();
  }
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
    if (preview && selected !== 'openai') {
      try {
        await playElevenSample(selection.voice, epoch);
      } catch (cause) {
        if (generation.current === epoch) {
          end();
          reportFailure(
            cause instanceof ClientError
              ? cause.message
              : `This ${providerNames[selected]} sample could not play. Try again.`,
            rejectedVoiceKey(cause),
          );
        }
      }
      return;
    }
    if (!preview && selected === 'grok') {
      let started = false;
      const call = new GrokSession(
        {
          onStarted() {
            if (generation.current !== epoch) return;
            started = true;
            clearTimeout(setupTimer.current);
            setState('live');
          },
          onAudioLevel(level) {
            if (generation.current === epoch) audioActivity.current?.update(level);
          },
          onAutoplayBlocked() {
            if (generation.current === epoch) setBlockedAudio(true);
          },
          onTranscript(fragment) {
            if (generation.current !== epoch) return;
            setCaptions((previous) => {
              const last = previous.at(-1);
              if (!fragment.done && last?.speaker === fragment.speaker)
                return [
                  ...previous.slice(0, -1),
                  { speaker: last.speaker, text: (last.text + fragment.text).slice(-4000) },
                ];
              return [...previous.slice(-39), { speaker: fragment.speaker, text: fragment.text }];
            });
          },
          onAsk(toolCallId, request) {
            if (generation.current !== epoch) return;
            if (queue.current.length >= 4) {
              call.answer(
                toolCallId,
                'Several requests are already waiting. Ask the owner to wait.',
              );
              return;
            }
            queue.current.push({ id: crypto.randomUUID(), text: request, toolCallId });
            void drain();
          },
          onClosed(message) {
            if (generation.current !== epoch) return;
            end();
            if (started) setError(message);
            else reportFailure(message);
          },
        },
        async () => {
          await savePreferences(true, selection, selected);
          return rpc('voice.start');
        },
      );
      live.current = call;
      setupTimer.current = setTimeout(() => {
        if (generation.current !== epoch) return;
        end();
        reportFailure('The voice connection timed out. Try again.');
      }, 45000);
      try {
        await call.start();
      } catch (cause) {
        if (generation.current !== epoch) return;
        end();
        reportFailure(voiceFailure(cause), rejectedVoiceKey(cause));
      }
      return;
    }
    if (!preview && selected === 'elevenlabs') {
      let started = false;
      const call = new SpokenSession(
        {
          onStarted() {
            if (generation.current !== epoch) return;
            started = true;
            clearTimeout(setupTimer.current);
            setState('live');
          },
          onAudioLevel(level) {
            if (generation.current === epoch) audioActivity.current?.update(level);
          },
          onAutoplayBlocked() {
            if (generation.current === epoch) setBlockedAudio(true);
          },
          onPartial(text) {
            if (generation.current === epoch) setPartialCaption(text);
          },
          onUtterance(utterance) {
            if (generation.current !== epoch) return;
            setCaptions((previous) => [
              ...previous.slice(-39),
              { speaker: 'user', text: utterance.text },
            ]);
            if (queue.current.length >= 4) {
              setError('Several spoken turns are waiting. Give this Pebble a moment.');
              return;
            }
            queue.current.push(utterance);
            void drain();
          },
          onClosed(message) {
            if (generation.current !== epoch) return;
            end();
            if (started) setError(message);
            else reportFailure(message);
          },
        },
        async () => {
          await savePreferences(true, selection, selected);
          return rpc('voice.start');
        },
      );
      live.current = call;
      setupTimer.current = setTimeout(() => {
        if (generation.current !== epoch) return;
        end();
        reportFailure('The voice connection timed out. Try again.');
      }, 45000);
      try {
        await call.start();
      } catch (cause) {
        if (generation.current !== epoch) return;
        end();
        reportFailure(voiceFailure(cause), rejectedVoiceKey(cause));
      }
      return;
    }
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
          previewTimer.current = setTimeout(() => end(), 30000);
        }
      },
      onSpeakingChange(speaking) {
        if (!preview || generation.current !== epoch) return;
        if (!previewHeard) return;
        clearTimeout(previewTimer.current);
        previewTimer.current = setTimeout(() => end(), speaking ? 30000 : 1500);
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
          call.speak(id, 'Several requests are already waiting. Ask the owner to wait.');
          return;
        }
        queue.current.push({ id: crypto.randomUUID(), text: prompt.text, delegationId: id });
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
    const call = new VoiceLiveSession(handlers, async (sdp) => {
      await savePreferences(!preview, selection, selected);
      if (!preview) {
        // The bridge's call record: the Pebble's spoken turns and call history.
        const started = record(await rpc('voice.start'));
        if (typeof started.call_id !== 'string' || !/^[a-f0-9]{32}$/.test(started.call_id))
          throw new Error('Invalid voice call');
        if (generation.current !== epoch) throw new Error('Voice operation was closed.');
        liveCall.current = started.call_id;
      }
      return sessionAnswer(await rpc('voice.session', { sdp, preview }));
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
          voiceCatalog={
            loadElevenVoices && (
              <>
                {catalogState === 'loading' && (
                  <LoadingBar active label="Loading ElevenLabs voices" />
                )}
                {catalogState === 'ready' && Object.keys(elevenLabels).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No ElevenLabs voices are available.
                  </p>
                )}
                {(catalogState === 'key' || catalogState === 'error') && (
                  <Alert>
                    <AlertDescription>
                      {catalogState === 'key'
                        ? 'Couldn’t load ElevenLabs voices. Check that your ElevenLabs key has Voices read access.'
                        : 'Couldn’t load ElevenLabs voices.'}
                      <Button
                        variant="link"
                        onClick={() => setCatalogAttempt((value) => value + 1)}
                      >
                        Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )
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
          onStopPreview={() => end()}
          startIntent={
            (settingsRequest?.kind === 'start' ||
              settingsRequest?.kind === 'failure' ||
              settingsRequest?.kind === 'key-failure') &&
            !!onReady
          }
          audioBlocked={blockedAudio}
          onEnableAudio={() => {
            void (sampleContext.current?.resume() ?? live.current?.resumeAudio())
              ?.then(() => setBlockedAudio(false))
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
                ...(provider !== 'openai' ? { provider } : {}),
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
              className="mx-auto grid w-full min-w-0 max-w-lg grid-cols-1 gap-2 px-3 pb-2"
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
                  {partialCaption && <p className="text-muted-foreground">{partialCaption}</p>}
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
