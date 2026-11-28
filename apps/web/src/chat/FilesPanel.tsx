import { Button } from '../components/ui/button';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { PhotoSize, SessionClient } from '@hermes-client/protocol';
import { Notice } from '../ui/primitives';
import { LoadingBar } from '../components/ui/loading-bar';
export type { SharedConversationFile as SharedFile } from '@hermes-client/protocol';
import type { SharedConversationFile as SharedFile } from '@hermes-client/protocol';
import { ConversationDomain } from '@hermes-client/protocol';
import { Download, Film, FileText } from 'lucide-react';
import { IconButton } from '../components/ui/icon-button';
import { saveMedia } from './media-save';
import type { GalleryItem } from './media-gallery-context';
const MediaGallery = lazy(() => import('../components/ui/media-gallery'));
import { documentFormat } from '@hermes-client/protocol';
import { useDocumentActions } from '../documents/DocumentReader';
import { Dialog } from '../components/ui/dialog';
const ImageViewer = lazy(() => import('../components/ui/image-viewer'));
const INITIAL_MEDIA_PAGES = 3;
type Generated = Awaited<ReturnType<ConversationDomain['mediaPage']>>['files'][number];
type LibraryItem = { kind: 'upload'; file: SharedFile } | { kind: 'generated'; file: Generated };
const key = (item: LibraryItem) =>
  item.kind === 'upload' ? item.file.id : `${item.file.rowId}:${item.file.reference}`;
export function fileSize(size: number) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.round(size / 1024)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
export function FilesPanel({
  active = true,
  client,
  sessionId,
  version,
  focusId,
}: {
  active?: boolean;
  client: SessionClient;
  sessionId: string;
  version: number;
  focusId?: string | undefined;
}) {
  const openDocument = useDocumentActions();
  const [items, setItems] = useState<LibraryItem[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState('');
  const [cursor, setCursor] = useState<string | null>(null),
    [more, setMore] = useState(false);
  const [viewer, setViewer] = useState<{
    url: string;
    name: string;
    kind: 'image' | 'video';
    blob: Blob;
  }>();
  const [gallery, setGallery] = useState<{ items: GalleryItem[]; index: number }>();
  useEffect(() => {
    // Release the open video's object URL when it closes or changes.
    const url = viewer?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [viewer?.url]);
  const generation = useRef(0);
  useEffect(() => {
    if (!active) return;
    const epoch = ++generation.current,
      domain = new ConversationDomain(client);
    setLoading(true);
    setError('');
    setCursor(null);
    async function generated() {
      const files: LibraryItem[] = [];
      let next: string | null = null;
      let pages = 0;
      if (client.supportsGeneratedMedia)
        do {
          const page = await domain.mediaPage(sessionId, next);
          pages++;
          if (generation.current !== epoch) return { files, next: null };
          files.push(...page.files.map((file) => ({ kind: 'generated' as const, file })));
          next = page.next;
        } while (next && files.length < 20 && pages < INITIAL_MEDIA_PAGES);
      return { files, next };
    }
    async function load() {
      const [uploads, media] = await Promise.allSettled([
        client.supportsAttachments ? domain.files(sessionId) : Promise.resolve([]),
        generated(),
      ]);
      if (generation.current !== epoch) return;
      const files: LibraryItem[] = [
        ...(uploads.status === 'fulfilled'
          ? uploads.value.map((file) => ({ kind: 'upload' as const, file }))
          : []),
        ...(media.status === 'fulfilled' ? media.value.files : []),
      ];
      setItems([...new Map(files.map((item) => [key(item), item])).values()]);
      setCursor(media.status === 'fulfilled' ? media.value.next : null);
      setError(
        uploads.status === 'rejected' && media.status === 'rejected'
          ? 'Library could not be loaded.'
          : uploads.status === 'rejected'
            ? 'Uploaded files could not be loaded. Agent media is still available.'
            : media.status === 'rejected'
              ? 'Agent media could not be loaded. Uploaded files are still available.'
              : '',
      );
    }
    void load()
      .catch(() => {
        if (generation.current === epoch) setError('Library could not be loaded.');
      })
      .finally(() => {
        if (generation.current === epoch) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [client, sessionId, version, retry, active]);
  useEffect(
    () => () => {
      if (viewer) URL.revokeObjectURL(viewer.url);
    },
    [viewer],
  );
  useEffect(() => {
    if (focusId && !loading)
      document
        .querySelector<HTMLElement>(`[data-file-id="${CSS.escape(focusId)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusId, loading, items]);
  async function loadMore() {
    if (!cursor || more) return;
    const epoch = generation.current;
    setMore(true);
    setError('');
    try {
      const page = await new ConversationDomain(client).mediaPage(sessionId, cursor);
      if (generation.current !== epoch) return;
      setItems((previous) => [
        ...new Map(
          [...previous, ...page.files.map((file) => ({ kind: 'generated' as const, file }))].map(
            (item) => [key(item), item],
          ),
        ).values(),
      ]);
      setCursor(page.next);
    } catch {
      if (generation.current === epoch) setError('Library changed. Refresh it to continue.');
    } finally {
      setMore(false);
    }
  }
  async function blob(item: LibraryItem, signal?: AbortSignal, size?: PhotoSize) {
    return item.kind === 'upload'
      ? client.downloadFile(sessionId, item.file.id, signal, size)
      : (await client.downloadMedia(sessionId, item.file.rowId, item.file.reference, signal, size))
          .blob;
  }
  const isPhoto = (item: LibraryItem) => /\.(?:png|jpe?g|webp|gif|avif)$/i.test(item.file.name);
  function openPhoto(item: LibraryItem) {
    const photos = items.filter(isPhoto);
    setGallery({
      items: photos.map((photo) => ({
        key: key(photo),
        name: photo.file.name,
        load: (signal: AbortSignal, size?: PhotoSize) => blob(photo, signal, size),
      })),
      index: Math.max(0, photos.indexOf(item)),
    });
  }
  async function view(item: LibraryItem) {
    if (isPhoto(item)) {
      openPhoto(item);
      return;
    }
    if (documentFormat(item.file.name) && openDocument) {
      openDocument({ name: item.file.name, load: () => blob(item) });
      return;
    }
    const epoch = generation.current;
    setBusy(key(item));
    setError('');
    try {
      const data = await blob(item);
      if (generation.current === epoch)
        setViewer({
          url: URL.createObjectURL(data),
          name: item.file.name,
          kind: /\.mp4$/i.test(item.file.name) ? 'video' : 'image',
          blob: data,
        });
    } catch {
      if (generation.current === epoch) setError('This item could not be opened.');
    } finally {
      setBusy('');
    }
  }
  async function download(item: LibraryItem) {
    setBusy(key(item));
    setError('');
    try {
      await saveMedia(await blob(item), item.file.name);
    } catch {
      setError('This item could not be downloaded.');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="files-panel">
      <LoadingBar active={loading || more} label="Loading Library" />
      {error && (
        <Notice error>
          {error}
          <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        </Notice>
      )}
      {!loading && !error && !items.length && !cursor && (
        <p className="empty-note">Nothing shared here yet.</p>
      )}
      <ul className="grid grid-cols-3 gap-2 p-1" aria-label="Library items">
        {items.map((item) => (
          <LibraryTile
            key={key(item)}
            id={key(item)}
            name={item.file.name}
            size={item.file.size}
            photo={isPhoto(item)}
            video={/\.mp4$/i.test(item.file.name)}
            viewable={
              isPhoto(item) ||
              /\.mp4$/i.test(item.file.name) ||
              (!!documentFormat(item.file.name) && !!openDocument)
            }
            busy={busy === key(item)}
            disabled={!!busy}
            load={(signal) => blob(item, signal, 'thumb')}
            onOpen={() => void view(item)}
            onDownload={() => void download(item)}
          />
        ))}
      </ul>
      {!!cursor && (
        <Button variant="quiet" disabled={more} onClick={() => void loadMore()}>
          Load more
        </Button>
      )}
      <Dialog
        open={!!gallery}
        onOpenChange={(open) => {
          if (!open) setGallery(undefined);
        }}
      >
        {gallery && (
          <Suspense fallback={<LoadingBar active label="Opening photo" />}>
            <MediaGallery
              items={gallery.items}
              initialIndex={gallery.index}
              open
              onOpenChange={(open) => {
                if (!open) setGallery(undefined);
              }}
            />
          </Suspense>
        )}
      </Dialog>
      <Dialog
        open={!!viewer}
        onOpenChange={(open) => {
          if (!open) setViewer(undefined);
        }}
      >
        {viewer && (
          <Suspense fallback={<LoadingBar active label="Opening media" />}>
            <ImageViewer
              src={viewer.url}
              alt={viewer.name}
              kind={viewer.kind}
              open
              onOpenChange={(open) => {
                if (!open) setViewer(undefined);
              }}
              onDownload={() => void saveMedia(viewer.blob, viewer.name)}
            />
          </Suspense>
        )}
      </Dialog>
    </div>
  );
}

/** A square Library tile: a cropped preview for photos, an icon and name for anything else. */
function LibraryTile({
  id,
  name,
  size,
  photo,
  video,
  viewable,
  busy,
  disabled,
  load,
  onOpen,
  onDownload,
}: {
  id: string;
  name: string;
  size: number;
  photo: boolean;
  video: boolean;
  viewable: boolean;
  busy: boolean;
  disabled: boolean;
  load: (signal: AbortSignal) => Promise<Blob>;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const host = useRef<HTMLLIElement>(null);
  const [preview, setPreview] = useState<string | 'error'>();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!photo || !host.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '300px' },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [photo]);
  useEffect(() => {
    if (!photo || !visible) return;
    const controller = new AbortController();
    let url: string | undefined;
    load(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(data);
        setPreview(url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreview('error');
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
    // `load` is recreated each render; the tile identity is its id.
  }, [photo, visible, id]);
  const Icon = video ? Film : FileText;
  return (
    <li ref={host} data-file-id={id} className="relative aspect-square">
      <button
        type="button"
        aria-label={viewable ? `View ${name}` : `Download ${name}`}
        disabled={disabled}
        onClick={viewable ? onOpen : onDownload}
        className="flex size-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl bg-muted p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
      >
        {photo && <span className="sr-only">{name}</span>}
        {photo && preview && preview !== 'error' ? (
          <img
            src={preview}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full rounded-xl object-cover"
          />
        ) : (
          <>
            <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <span className="line-clamp-3 text-xs break-all">{name}</span>
            <span className="text-[0.6875rem] text-muted-foreground">{fileSize(size)}</span>
          </>
        )}
      </button>
      {!photo && viewable && (
        <IconButton
          label={`Download ${name}`}
          icon={Download}
          disabled={disabled}
          className="absolute right-1 bottom-1 size-8 rounded-full"
          onClick={onDownload}
        />
      )}
      <LoadingBar as="span" active={busy} label={`Opening ${name}`} />
    </li>
  );
}
