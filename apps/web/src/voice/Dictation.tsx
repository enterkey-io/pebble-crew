import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { IconButton } from '../components/ui/icon-button';
import { markSent, nothingSent, pendingText } from './dictation-text';
import type { HeardResult, SentMark } from './dictation-text';

export type DictationHandle = { toggle: () => void; stop: () => void };

/** How long the words must stop changing before they are sent. Natural
 *  pauses while thinking mid-sentence often run past two seconds. */
export const dictationPauseMs = 3000;

type RecognitionResults = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: { results: RecognitionResults }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type RecognitionClass = new () => Recognition;

/** Apple's built-in speech recognition in Safari on Mac, iPhone and iPad.
 *  Other browsers (Chrome sends audio to Google) do not offer dictation. */
export function builtInRecognition(): RecognitionClass | undefined {
  if (typeof window === 'undefined' || navigator.vendor !== 'Apple Computer, Inc.') return;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionClass;
    webkitSpeechRecognition?: RecognitionClass;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

const refused = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

/** Continuous dictation: words appear in the message box as they are heard, a
 *  pause sends them, and listening continues until the owner turns it off. */
export const Dictation = forwardRef<
  DictationHandle,
  {
    disabled: boolean;
    onWords: (text: string) => void;
    onText: (text: string) => void;
    onError: (message: string) => void;
    onActiveChange: (active: boolean) => void;
  }
>(function Dictation({ disabled, onWords, onText, onError, onActiveChange }, ref) {
  const [state, setState] = useState<'off' | 'starting' | 'on'>('off');
  const recognition = useRef<Recognition | undefined>(undefined);
  const handlers = useRef({ onWords, onText, onError, onActiveChange });
  handlers.current = { onWords, onText, onError, onActiveChange };
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Sessions in a row that ended within a second, so a broken one cannot loop. */
  const quickEnds = useRef(0);
  /** Unsent words from recognition sessions Safari has already ended. */
  const carried = useRef('');
  /** The current session's unsent words, and marking them sent. */
  const session = useRef<{ text: () => string; mark: () => void }>({
    text: () => '',
    mark: () => undefined,
  });
  const join = (...parts: string[]) => parts.filter(Boolean).join(' ');

  /** Sends everything heard since the last send. */
  function flush() {
    clearTimeout(pause.current);
    const text = join(carried.current, session.current.text());
    session.current.mark();
    carried.current = '';
    if (text) handlers.current.onText(text);
  }

  function stop() {
    clearTimeout(pause.current);
    carried.current = '';
    const current = recognition.current;
    recognition.current = undefined;
    current?.abort();
    setState('off');
  }

  function start() {
    const Recognizer = builtInRecognition();
    if (!Recognizer || recognition.current) return;
    const listening = new Recognizer();
    let results: HeardResult[] = [];
    let sent: SentMark = nothingSent;
    let shown = '';
    const live = () => recognition.current === listening;
    const began = Date.now();
    session.current = {
      text: () => pendingText(results, sent),
      mark: () => {
        sent = markSent(results);
        shown = '';
      },
    };
    listening.continuous = true;
    listening.interimResults = true;
    listening.lang = navigator.language || 'en-US';
    listening.onstart = () => {
      if (live()) setState('on');
    };
    listening.onresult = (event) => {
      if (!live()) return;
      results = Array.from(event.results, (result) => ({
        transcript: result[0]?.transcript ?? '',
        final: result.isFinal,
      }));
      const text = pendingText(results, sent);
      if (text === shown) return;
      shown = text;
      const all = join(carried.current, text);
      handlers.current.onWords(all);
      clearTimeout(pause.current);
      if (all) pause.current = setTimeout(() => recognition.current && flush(), dictationPauseMs);
    };
    listening.onerror = (event) => {
      if (!live() || !refused.has(event.error)) return;
      stop();
      handlers.current.onError(
        'Allow the microphone and speech recognition for this site, then try again.',
      );
    };
    // Safari ends a session after a while, often in a pause mid-sentence. Keep its
    // words for the next session; only the pause timer sends them.
    listening.onend = () => {
      if (!live()) return;
      carried.current = join(carried.current, pendingText(results, sent));
      session.current.mark();
      recognition.current = undefined;
      quickEnds.current = Date.now() - began < 1000 ? quickEnds.current + 1 : 0;
      if (quickEnds.current > 5) {
        setState('off');
        handlers.current.onError('Dictation stopped. Turn it on again to keep going.');
        return;
      }
      start();
    };
    recognition.current = listening;
    setState((value) => (value === 'on' ? 'on' : 'starting'));
    try {
      listening.start();
    } catch {
      stop();
      handlers.current.onError('Dictation could not start. Try again.');
    }
  }

  function toggle() {
    if (recognition.current) stop();
    else if (!disabled) {
      quickEnds.current = 0;
      start();
    }
  }

  useImperativeHandle(ref, () => ({ toggle, stop }));
  useEffect(
    () => () => {
      clearTimeout(pause.current);
      const current = recognition.current;
      recognition.current = undefined;
      current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (disabled && recognition.current) stop();
  }, [disabled]);

  const active = state !== 'off';
  useEffect(() => {
    handlers.current.onActiveChange(active);
  }, [active]);
  useEffect(() => () => handlers.current.onActiveChange(false), []);

  return (
    <IconButton
      quiet
      size="icon"
      className={
        'self-end' +
        (active
          ? ' rounded-full bg-foreground text-background hover:bg-foreground/90 hover:text-background' +
            (state === 'starting' ? ' opacity-70' : '')
          : '')
      }
      label={active ? 'Stop dictation' : 'Dictate'}
      aria-pressed={active}
      icon={Mic}
      disabled={disabled && !active}
      onClick={toggle}
    />
  );
});
