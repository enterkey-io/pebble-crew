import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionClient, DownloadedMedia } from '@hermes-client/protocol';
import { Download, Eye, File, RotateCw, Play, Expand } from 'lucide-react';
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
import { Dialog, DialogTrigger } from '../components/ui/dialog';

import { documentFormat } from '@hermes-client/protocol';
import { useDocumentActions } from '../documents/DocumentReader';

const ImageViewerContent = lazy(() => import('../components/ui/image-viewer'));

export type MessageMedia =
  | { kind: 'pending'; identity: string }
  | { kind: 'saved'; identity: string; client: SessionClient; sessionId: string; rowId: number };
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

function decodeName(source: string) {
  try {
    return decodeURIComponent(source).split('/').pop() || 'File';
  } catch {
    return 'File';
  }
}

export function GeneratedFile({ source, children }: { source: string; children: ReactNode }) {
  const media = useContext(MessageMediaContext);
  const openDocument = useDocumentActions();
  const name = decodeName(source);
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
  if (/\.mp4$/i.test(name)) return <GeneratedImage source={source} alt={name} />;
  return (
    <Attachment
      size="sm"
      state={state === 'error' ? 'error' : state === 'loading' ? 'processing' : 'done'}
      className="generated-file flex-nowrap text-left"
    >
      <AttachmentMedia>
        <File aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{children}</AttachmentTitle>
        {state === 'error' && (
          <AttachmentDescription>File unavailable · Try again</AttachmentDescription>
        )}
      </AttachmentContent>
      {documentFormat(name) && openDocument && (
        <IconButton
          label={`View ${name}`}
          icon={Eye}
          disabled={media?.kind !== 'saved'}
          onClick={() => {
            if (media?.kind !== 'saved') return;
            openDocument({
              name,
              load: async (signal) => {
                const reference = await referenceKey(source);
                return (
                  await media.client.downloadMedia(media.sessionId, media.rowId, reference, signal)
                ).blob;
              },
            });
          }}
        />
      )}
      <IconButton
        label={
          typeof children === 'string' && /^download /i.test(children)
            ? children
            : `Download ${name}`
        }
        icon={Download}
        disabled={media?.kind !== 'saved' || state === 'loading'}
        onClick={() => void download()}
      />
      <LoadingBar as="span" active={state === 'loading'} label="Downloading file" />
    </Attachment>
  );
}

type ImageState =
  | { kind: 'idle'; key: string }
  | { kind: 'loading'; key: string }
  | { kind: 'error'; key: string }
  | { kind: 'ready'; key: string; file: DownloadedMedia; url: string };
export function GeneratedImage({ source, alt }: { source: string; alt: string }) {
  const media = useContext(MessageMediaContext);
  const key = `${media?.identity ?? ''}:${source}`;
  const video = /\.mp4$/i.test(decodeName(source));
  const player = useRef<HTMLVideoElement>(null);
  const playRequested = useRef(false);
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewer, setViewer] = useState<{ key: string; open: boolean; time?: number }>();
  const [loaded, setState] = useState<ImageState>({ kind: 'idle', key });
  const state: ImageState = loaded.key === key ? loaded : { kind: 'idle', key };
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
  const viewerOpen = viewer?.key === key && viewer.open;
  useEffect(() => {
    if (video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: '200px' },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [video]);
  useEffect(() => {
    if (!video && !visible && !viewerOpen) {
      if (resource.current) URL.revokeObjectURL(resource.current.url);
      resource.current = undefined;
      setState({ kind: 'idle', key });
      return;
    }
    if ((!visible && !viewerOpen) || media?.kind !== 'saved') return;
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
  }, [media, source, visible, viewerOpen, video, attempt, key]);
  useEffect(() => {
    if (state.kind === 'ready' && video && playRequested.current) {
      playRequested.current = false;
      void player.current?.play().catch(() => {
        /* Native controls remain available if playback requires another tap. */
      });
    }
  }, [state, video]);
  useEffect(() => {
    function pause() {
      if (document.hidden) player.current?.pause();
    }
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  return (
    <span className="message-image rounded-2xl" data-media={video ? 'video' : 'image'} ref={host}>
      {state.kind === 'ready' && state.file.blob.type === 'video/mp4' ? (
        <>
          <video
            ref={player}
            controls
            playsInline
            preload="metadata"
            src={state.url}
            aria-label={alt || state.file.name}
            className="block size-full rounded-2xl bg-black object-contain"
          />
          <Dialog
            open={viewer?.key === key && viewer.open}
            onOpenChange={(open) => {
              const time = player.current?.currentTime ?? 0;
              if (open) player.current?.pause();
              setViewer({ key, open, time });
            }}
          >
            <DialogTrigger asChild>
              <IconButton
                className="absolute top-1 left-1 rounded-full bg-black/60 text-white hover:bg-black/80 hover:text-white"
                label={`View ${alt || state.file.name}`}
                icon={Expand}
              />
            </DialogTrigger>
            {viewer?.key === key && (
              <Suspense fallback={<LoadingBar as="span" active label="Opening video" />}>
                <ImageViewerContent
                  kind="video"
                  src={state.url}
                  alt={alt || state.file.name}
                  initialTime={viewer.time ?? 0}
                  open={viewer.open}
                  onDownload={() => save(state.file)}
                  onOpenChange={(open) => setViewer({ key, open })}
                />
              </Suspense>
            )}
          </Dialog>
          <IconButton
            className="absolute top-1 right-1 rounded-full bg-black/60 text-white hover:bg-black/80 hover:text-white"
            label={`Download ${state.file.name}`}
            icon={Download}
            onClick={() => save(state.file)}
          />
        </>
      ) : state.kind === 'ready' && state.file.blob.type.startsWith('image/') ? (
        <>
          <Dialog
            open={viewer?.key === key && viewer.open}
            onOpenChange={(open) => setViewer({ key, open })}
          >
            <DialogTrigger asChild>
              <Button
                variant="quiet"
                className="message-image-open flex size-full cursor-zoom-in items-center justify-center overflow-hidden rounded-2xl p-0"
                aria-label={`View ${alt || state.file.name}`}
              >
                <img
                  className="block h-auto max-h-full w-auto max-w-full rounded-2xl object-contain"
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
              </Button>
            </DialogTrigger>
            {viewer?.key === key && (
              <Suspense fallback={<LoadingBar as="span" active label="Opening image" />}>
                <ImageViewerContent
                  src={state.url}
                  alt={alt || state.file.name}
                  open={viewer.open}
                  onOpenChange={(open) => setViewer({ key, open })}
                />
              </Suspense>
            )}
          </Dialog>
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
      ) : video && !visible && media?.kind === 'saved' ? (
        <Button
          variant="quiet"
          className="flex size-full flex-col gap-2 rounded-2xl bg-muted p-4"
          aria-label={`Play ${alt || decodeName(source)}`}
          onClick={() => {
            playRequested.current = true;
            setVisible(true);
          }}
        >
          <Play className="size-7" />
          <span className="max-w-full truncate text-xs text-muted-foreground">
            {alt || decodeName(source)}
          </span>
        </Button>
      ) : state.kind === 'error' || !media ? (
        <span className="message-image-error">
          {video ? 'Video unavailable' : 'Image unavailable'}
          {media && (
            <IconButton
              label={video ? 'Retry video' : 'Retry image'}
              icon={RotateCw}
              onClick={() => setAttempt((value) => value + 1)}
            />
          )}
        </span>
      ) : state.kind === 'idle' ? (
        <span aria-hidden="true" />
      ) : (
        <LoadingBar as="span" active label={video ? 'Loading video' : 'Loading image'} />
      )}
    </span>
  );
}
