import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { SessionClient, DownloadedMedia, PhotoSize } from '@hermes-client/protocol';
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
const MediaGalleryContent = lazy(() => import('../components/ui/media-gallery'));
import { useGalleryPhoto } from './media-gallery-context';
import type { GalleryItem } from './media-gallery-context';
import { saveMedia } from './media-save';

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
export function GeneratedImage({
  source,
  alt,
  upload,
}: {
  source: string;
  alt: string;
  upload?: { client: SessionClient; sessionId: string };
}) {
  const media = useContext(MessageMediaContext);
  const uploadClient = upload?.client,
    uploadSession = upload?.sessionId;
  const key = uploadSession
    ? `upload:${uploadSession}:${source}`
    : `${media?.identity ?? ''}:${source}`;
  const uploaded = !!uploadClient && !!uploadSession;
  const available = uploaded || media?.kind === 'saved';
  const video = /\.mp4$/i.test(decodeName(source));
  const player = useRef<HTMLVideoElement>(null);
  const playRequested = useRef(false);
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewer, setViewer] = useState<{
    key: string;
    open: boolean;
    time?: number;
    gallery?: { items: GalleryItem[]; index: number };
  }>();
  const photo = useMemo<GalleryItem | undefined>(() => {
    if (video) return;
    const name = decodeName(source);
    if (uploadClient && uploadSession)
      return {
        key,
        name: alt || name,
        load: (signal, size) => uploadClient.downloadFile(uploadSession, source, signal, size),
        cached: () => held.current,
      };
    if (media?.kind !== 'saved') return;
    return {
      key,
      name,
      // Agents describe their photos in the alt text; a bare file name is not a title.
      title: alt && alt !== name && !/^(?:photo|image)$/i.test(alt.trim()) ? alt : undefined,
      load: async (signal, size) =>
        (
          await media.client.downloadMedia(
            media.sessionId,
            media.rowId,
            await referenceKey(source),
            signal,
            size,
          )
        ).blob,
      cached: () => held.current,
    };
  }, [video, source, alt, key, media, uploadClient, uploadSession]);
  const openGallery = useGalleryPhoto(host, photo);
  /** The chat shows a smaller copy; saving always fetches the original. */
  const [saving, setSaving] = useState(false);
  function saveOriginal(name: string) {
    if (!photo || saving) return;
    setSaving(true);
    void photo
      .load(new AbortController().signal)
      .then((blob) => saveMedia(blob, name))
      .catch(() => undefined)
      .finally(() => setSaving(false));
  }
  const held = useRef<{ blob: Blob; url: string } | undefined>(undefined);
  const [loaded, setState] = useState<ImageState>({ kind: 'idle', key });
  const state: ImageState = loaded.key === key ? loaded : { kind: 'idle', key };
  held.current = state.kind === 'ready' ? { blob: state.file.blob, url: state.url } : undefined;
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
    if ((!visible && !viewerOpen) || !available) return;
    if (resource.current?.key === key) return;
    const controller = new AbortController();
    setState({ kind: 'loading', key });
    // Photos show a chat-sized copy; the original loads only to view or save it.
    const size: PhotoSize | undefined = video ? undefined : 'preview';
    const download = uploaded
      ? uploadClient
          .downloadFile(uploadSession, source, controller.signal, size)
          .then((blob) => ({ blob, name: alt }))
      : media?.kind === 'saved'
        ? referenceKey(source).then((reference) =>
            media.client.downloadMedia(
              media.sessionId,
              media.rowId,
              reference,
              controller.signal,
              size,
            ),
          )
        : undefined;
    void download
      ?.then((file) => {
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
  }, [
    media,
    source,
    alt,
    uploadClient,
    uploadSession,
    uploaded,
    available,
    visible,
    viewerOpen,
    video,
    attempt,
    key,
  ]);
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
                  onDownload={() => void saveMedia(state.file.blob, state.file.name)}
                  onOpenChange={(open) => setViewer({ key, open })}
                />
              </Suspense>
            )}
          </Dialog>
          <IconButton
            className="absolute top-1 right-1 rounded-full bg-black/60 text-white hover:bg-black/80 hover:text-white"
            label={`Download ${state.file.name}`}
            icon={Download}
            onClick={() => void saveMedia(state.file.blob, state.file.name)}
          />
        </>
      ) : state.kind === 'ready' && state.file.blob.type.startsWith('image/') ? (
        <>
          <Dialog
            open={viewer?.key === key && viewer.open}
            onOpenChange={(open) =>
              setViewer(
                open
                  ? { key, open, ...(openGallery() ? { gallery: openGallery()! } : {}) }
                  : { key, open },
              )
            }
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
            {viewer?.key === key && viewer.gallery && (
              <Suspense fallback={<LoadingBar as="span" active label="Opening image" />}>
                <MediaGalleryContent
                  items={viewer.gallery.items}
                  initialIndex={viewer.gallery.index}
                  open={viewer.open}
                  onOpenChange={(open) => setViewer({ key, open })}
                />
              </Suspense>
            )}
            {viewer?.key === key && !viewer.gallery && (
              <Suspense fallback={<LoadingBar as="span" active label="Opening image" />}>
                <ImageViewerContent
                  src={state.url}
                  alt={alt || state.file.name}
                  open={viewer.open}
                  onSave={() => saveOriginal(state.file.name)}
                  onOpenChange={(open) => setViewer({ key, open })}
                />
              </Suspense>
            )}
          </Dialog>
          <IconButton
            variant="secondary"
            className="message-image-download rounded-full hover:bg-accent hover:text-accent-foreground"
            label={`Download ${state.file.name}`}
            icon={Download}
            disabled={saving}
            onClick={() => state.kind === 'ready' && saveOriginal(state.file.name)}
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
      ) : state.kind === 'error' || (!media && !uploaded) ? (
        <span className="message-image-error">
          {video ? 'Video unavailable' : 'Image unavailable'}
          {available && (
            <IconButton
              label={video ? 'Retry video' : 'Retry image'}
              icon={RotateCw}
              onClick={() => setAttempt((value) => value + 1)}
            />
          )}
        </span>
      ) : state.kind === 'idle' && (available || media?.kind !== 'pending') ? (
        <span aria-hidden="true" />
      ) : (
        <LoadingBar as="span" active label={video ? 'Loading video' : 'Loading image'} />
      )}
    </span>
  );
}

/** Several photos sent together, shown as a fanned stack of cards. Tapping it opens
 *  them in the gallery; each card may carry a title. */
export function PhotoStack({ photos }: { photos: { source: string; title: string }[] }) {
  const media = useContext(MessageMediaContext);
  const host = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [covers, setCovers] = useState<Record<string, string | 'error'>>({});
  // The stack takes the shape of its top photo: wide photos get a wide card.
  const [shape, setShape] = useState<'portrait' | 'landscape' | 'square'>();
  // The markdown renderer passes a new array each render; key the stack by content.
  const signature = JSON.stringify(photos);
  const items = useMemo<GalleryItem[]>(() => {
    if (media?.kind !== 'saved') return [];
    const list = JSON.parse(signature) as { source: string; title: string }[];
    return list.map(({ source, title }) => {
      const name = decodeName(source);
      return {
        key: `${media.identity}:${source}`,
        name,
        title: title && title !== name ? title : undefined,
        load: async (signal: AbortSignal, size?: PhotoSize) =>
          (
            await media.client.downloadMedia(
              media.sessionId,
              media.rowId,
              await referenceKey(source),
              signal,
              size,
            )
          ).blob,
      };
    });
  }, [media, signature]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '200px' },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  // Load the three cards that are visible in the fan: a chat-sized copy on top,
  // thumbnails behind it.
  useEffect(() => {
    if (!visible || !items.length) return;
    const controller = new AbortController();
    const urls: string[] = [];
    for (const [depth, item] of items.slice(0, 3).entries())
      item
        .load(controller.signal, depth ? 'thumb' : 'preview')
        .then((blob) => {
          if (controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setCovers((value) => ({ ...value, [item.key]: url }));
        })
        .catch(() => {
          if (!controller.signal.aborted) setCovers((value) => ({ ...value, [item.key]: 'error' }));
        });
    return () => {
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
      setCovers({});
    };
  }, [visible, items]);
  const fan = items.slice(0, 3);
  const top = fan[0];
  const label = `View ${items.length} photos${top?.title ? `, starting with ${top.title}` : ''}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          ref={host}
          type="button"
          aria-label={label}
          disabled={!items.length}
          data-shape={shape ?? 'square'}
          className={`photo-stack relative mx-3 mt-4 mb-8 block outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            shape === 'landscape'
              ? 'aspect-[4/3] w-[min(20rem,75vw)]'
              : shape === 'portrait'
                ? 'aspect-[4/5] w-[min(16rem,65vw)]'
                : 'aspect-square w-[min(17rem,68vw)]'
          }`}
        >
          {!items.length && <LoadingBar as="span" active label="Loading photos" />}
          {[...fan].reverse().map((item, reversed) => {
            const depth = fan.length - 1 - reversed;
            const cover = covers[item.key];
            return (
              <span
                key={item.key}
                aria-hidden={depth > 0}
                className="absolute inset-0 overflow-hidden rounded-2xl bg-muted shadow-[0_6px_24px_#0006] transition-transform"
                style={{
                  transform: `rotate(${[0, -6, 6][depth]}deg) translate(${[0, -10, 10][depth]}px, ${depth * 4}px)`,
                  zIndex: 3 - depth,
                }}
              >
                {cover && cover !== 'error' && (
                  <img
                    src={cover}
                    alt={depth ? '' : item.title || item.name}
                    draggable={false}
                    decoding="async"
                    style={{ WebkitTouchCallout: 'default' }}
                    className="size-full object-cover"
                    {...(depth
                      ? {}
                      : {
                          onLoad: ({ currentTarget: { naturalWidth: w, naturalHeight: h } }) =>
                            setShape(
                              w > h * 1.1 ? 'landscape' : h > w * 1.1 ? 'portrait' : 'square',
                            ),
                        })}
                  />
                )}
                {!depth && item.title && (
                  <span className="absolute inset-x-0 bottom-2 flex justify-center px-2">
                    <span className="max-w-full truncate rounded-full bg-neutral-500/60 px-3 py-1 text-xs text-white backdrop-blur-sm">
                      {item.title}
                    </span>
                  </span>
                )}
              </span>
            );
          })}
          <span className="absolute top-2 right-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
            {items.length}
          </span>
        </button>
      </DialogTrigger>
      {open && (
        <Suspense fallback={<LoadingBar as="span" active label="Opening photos" />}>
          <MediaGalleryContent items={items} initialIndex={0} open onOpenChange={setOpen} />
        </Suspense>
      )}
    </Dialog>
  );
}
