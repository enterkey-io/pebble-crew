import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { SharedDocument } from '@hermes-client/protocol';
import { decodeDocument, DOCUMENT_LIMIT, documentFormat } from '@hermes-client/protocol';
import { Download, X } from 'lucide-react';
import { MessageBody } from '../MessageBody';
import { IconButton } from '../components/ui/icon-button';
import { Button } from '../components/ui/button';
import { LoadingBar } from '../components/ui/loading-bar';
import { Alert, AlertDescription } from '../components/ui/alert';

export type DocumentSource = {
  name: string;
  load: (signal: AbortSignal) => Promise<Blob>;
};
export const DocumentActions = createContext<((source: DocumentSource) => void) | undefined>(
  undefined,
);
export function useDocumentActions() {
  return useContext(DocumentActions);
}

type ReaderState =
  | { kind: 'loading'; name: string }
  | { kind: 'ready'; document: SharedDocument }
  | { kind: 'error'; name: string; source: DocumentSource };

export function useDocumentReader(conversation: string) {
  const [entry, setEntry] = useState<{ conversation: string; state: ReaderState }>();
  const request = useRef<AbortController | undefined>(undefined);
  const trigger = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const state = entry?.conversation === conversation ? entry.state : undefined;
  useEffect(() => {
    generation.current++;
    request.current?.abort();
    setEntry(undefined);
    return () => request.current?.abort();
  }, [conversation]);
  const close = useCallback(() => {
    generation.current++;
    request.current?.abort();
    setEntry(undefined);
    const element = trigger.current;
    requestAnimationFrame(() => {
      (element?.isConnected ? element : document.querySelector<HTMLElement>('.chat-title'))?.focus({
        preventScroll: true,
      });
    });
  }, []);
  const show = useCallback(
    (document: SharedDocument) => {
      generation.current++;
      request.current?.abort();
      trigger.current =
        window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
      setEntry({ conversation, state: { kind: 'ready', document } });
    },
    [conversation],
  );
  const open = useCallback(
    (source: DocumentSource) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const turn = ++generation.current;
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setEntry({ conversation, state: { kind: 'loading', name: source.name } });
      void source
        .load(controller.signal)
        .then(async (blob) => {
          if (blob.size > DOCUMENT_LIMIT) throw new Error('Document too large');
          const text = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer());
          return decodeDocument({ name: source.name, text, format: documentFormat(source.name) });
        })
        .then((document) => {
          if (!controller.signal.aborted && generation.current === turn)
            setEntry({ conversation, state: { kind: 'ready', document } });
        })
        .catch(() => {
          if (!controller.signal.aborted && generation.current === turn)
            setEntry({ conversation, state: { kind: 'error', name: source.name, source } });
        });
    },
    [conversation],
  );
  return { state, open, show, close };
}

export function DocumentReader({
  state,
  onClose,
  onRetry,
}: {
  state: ReaderState;
  onClose: () => void;
  onRetry: (source: DocumentSource) => void;
}) {
  const name = state.kind === 'ready' ? state.document.name : state.name;
  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [name]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [name]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"][data-state="open"]')
      ) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <section className="pc-document-reader" aria-label="Document viewer">
      <header className="flex shrink-0 items-center gap-2 px-5 py-3">
        <h2
          ref={heading}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-sm font-medium outline-none"
        >
          {name}
        </h2>
        {state.kind === 'ready' && (
          <IconButton
            label={`Download ${name}`}
            icon={Download}
            onClick={() => {
              const blob = new Blob([state.document.text], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob),
                link = document.createElement('a');
              link.href = url;
              link.download = name;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          />
        )}
        <IconButton label="Close document" icon={X} onClick={onClose} />
      </header>
      <LoadingBar active={state.kind === 'loading'} label="Loading document" />
      <div
        ref={scroll}
        className="pc-document-scroll min-h-0 flex-1 overflow-auto overscroll-contain px-5 pb-8 pt-3"
      >
        {state.kind === 'error' ? (
          <Alert variant="destructive">
            <AlertDescription>
              This file couldn’t be opened. Preview supports UTF-8 Markdown and text up to 256 KB.
            </AlertDescription>
            <Button variant="secondary" onClick={() => onRetry(state.source)}>
              Try again
            </Button>
          </Alert>
        ) : state.kind === 'ready' ? (
          state.document.format === 'markdown' ? (
            <MessageBody text={state.document.text} />
          ) : (
            <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-7">
              {state.document.text}
            </pre>
          )
        ) : null}
      </div>
    </section>
  );
}
