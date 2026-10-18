import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BotBridgeClient, DownloadedMedia } from '@hermes-client/protocol';
import { Download, File, RotateCw } from 'lucide-react';
import { IconButton } from '../components/ui/icon-button';
import { LoadingBar } from '../components/ui/loading-bar';
import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
} from '../components/ui/attachment';
import { Button } from '../components/ui/button';

export type MessageMedia =
  | { kind: 'pending'; identity: string }
  | { kind: 'saved'; identity: string; client: BotBridgeClient; sessionId: string; rowId: number };
export const MessageMediaContext = createContext<MessageMedia | undefined>(undefined);

export function localReference(value: string) {
  return (
    !!value &&
    !/^(?:https?:|\/\/|#|mailto:)/i.test(value) &&
    (!/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('file:'))
  );
}

export async function referenceKey(value: string) {
  const normalized = decodeURIComponent(value);
  if (
    !normalized ||
    normalized.length > 4096 ||
    [...normalized].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error('Invalid file reference');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function save(file: DownloadedMedia) {
  const url = URL.createObjectURL(file.blob),
    link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function GeneratedFile({ source, children }: { source: string; children: ReactNode }) {
  const media = useContext(MessageMediaContext);
  const [state, setState] = useState<'ready' | 'loading' | 'error'>('ready');
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    setState('ready');
    return () => request.current?.abort();
  }, [media, source]);
  async function download() {
    if (media?.kind !== 'saved') return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setState('loading');
    try {
      const reference = await referenceKey(source);
      const file = await media.client.downloadMedia(
        media.sessionId,
        media.rowId,
        reference,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      save(file);
      setState('ready');
    } catch {
      if (!controller.signal.aborted) setState('error');
    }
  }
  return (
    <Attachment
      asChild
      size="sm"
      state={state === 'error' ? 'error' : state === 'loading' ? 'processing' : 'done'}
      className="generated-file flex-nowrap text-left"
    >
      <button
        type="button"
        disabled={media?.kind !== 'saved' || state === 'loading'}
        onClick={() => void download()}
      >
        <AttachmentMedia asChild>
          <span>
            <File aria-hidden="true" />
          </span>
        </AttachmentMedia>
        <AttachmentContent asChild>
          <span>
            <AttachmentTitle>{children}</AttachmentTitle>
            {state === 'error' && (
              <AttachmentDescription>File unavailable · Try again</AttachmentDescription>
            )}
          </span>
        </AttachmentContent>
        {state === 'error' ? <RotateCw aria-hidden="true" /> : <Download aria-hidden="true" />}
        <LoadingBar as="span" active={state === 'loading'} label="Downloading file" />
      </button>
    </Attachment>
  );
}

type ImageState =
  | { kind: 'loading'; key: string }
  | { kind: 'error'; key: string }
  | { kind: 'ready'; key: string; file: DownloadedMedia; url: string };
export function GeneratedImage({ source, alt }: { source: string; alt: string }) {
  const media = useContext(MessageMediaContext);
  const key = `${media?.identity ?? ''}:${source}`;
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setState] = useState<ImageState>({ kind: 'loading', key });
  const state: ImageState = loaded.key === key ? loaded : { kind: 'loading', key };
  const resource = useRef<{ key: string; url: string } | undefined>(undefined);
  useEffect(
    () => () => {
      if (resource.current?.key === key) {
        URL.revokeObjectURL(resource.current.url);
        resource.current = undefined;
      }
    },
    [key],
  );
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || media?.kind !== 'saved') return;
    if (resource.current?.key === key) return;
    const controller = new AbortController();
    setState({ kind: 'loading', key });
    void referenceKey(source)
      .then((reference) =>
        media.client.downloadMedia(media.sessionId, media.rowId, reference, controller.signal),
      )
      .then((file) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(file.blob);
        resource.current = { key, url };
        setState({ kind: 'ready', key, file, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error', key });
      });
    return () => {
      controller.abort();
    };
  }, [media, source, visible, attempt, key]);
  return (
    <span className="message-image" ref={host}>
      {state.kind === 'ready' && state.file.blob.type.startsWith('image/') ? (
        <>
          <img
            src={state.url}
            alt={alt || state.file.name}
            loading="lazy"
            decoding="async"
            onError={() => {
              if (resource.current?.url === state.url) {
                URL.revokeObjectURL(resource.current.url);
                resource.current = undefined;
              }
              setState({ kind: 'error', key });
            }}
          />
          <IconButton
            className="message-image-download"
            label={`Download ${state.file.name}`}
            icon={Download}
            onClick={() => state.kind === 'ready' && save(state.file)}
          />
        </>
      ) : state.kind === 'ready' ? (
        <Button
          variant="outline"
          className="h-auto max-w-full justify-start whitespace-normal"
          onClick={() => state.kind === 'ready' && save(state.file)}
        >
          <Download aria-hidden="true" />
          {state.file.name}
        </Button>
      ) : state.kind === 'error' || !media ? (
        <span className="message-image-error">
          Image unavailable
          {media && (
            <IconButton
              label="Retry image"
              icon={RotateCw}
              onClick={() => setAttempt((value) => value + 1)}
            />
          )}
        </span>
      ) : (
        <LoadingBar as="span" active label="Loading image" />
      )}
    </span>
  );
}
