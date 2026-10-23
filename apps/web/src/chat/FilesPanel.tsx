import { Button } from '../components/ui/button';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { SessionClient } from '@hermes-client/protocol';
import { Notice } from '../ui/primitives';
import { LoadingBar } from '../components/ui/loading-bar';
export type { SharedConversationFile as SharedFile } from '@hermes-client/protocol';
import type { SharedConversationFile as SharedFile } from '@hermes-client/protocol';
import { ConversationDomain } from '@hermes-client/protocol';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemMedia } from '../components/ui/item';
import { IconButton } from '../components/ui/icon-button';
import { Download, Eye, Image, Film, FileText } from 'lucide-react';
import { documentFormat } from '@hermes-client/protocol';
import { useDocumentActions } from '../documents/DocumentReader';
import { Dialog } from '../components/ui/dialog';
const ImageViewer = lazy(() => import('../components/ui/image-viewer'));
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
  client,
  sessionId,
  version,
  focusId,
}: {
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
  const generation = useRef(0);
  useEffect(() => {
    const epoch = ++generation.current,
      domain = new ConversationDomain(client);
    setLoading(true);
    setError('');
    setCursor(null);
    async function generated() {
      const files: LibraryItem[] = [];
      let next: string | null = null;
      if (client.supportsGeneratedMedia)
        do {
          const page = await domain.mediaPage(sessionId, next);
          if (generation.current !== epoch) return { files, next: null };
          files.push(...page.files.map((file) => ({ kind: 'generated' as const, file })));
          next = page.next;
        } while (next && files.length < 20);
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
  }, [client, sessionId, version, retry]);
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
  async function blob(item: LibraryItem) {
    return item.kind === 'upload'
      ? client.downloadFile(sessionId, item.file.id)
      : (await client.downloadMedia(sessionId, item.file.rowId, item.file.reference)).blob;
  }
  function save(value: Blob, name: string) {
    const url = URL.createObjectURL(value),
      link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function view(item: LibraryItem) {
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
      save(await blob(item), item.file.name);
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
      <ul className="file-list">
        {items.map((item) => {
          const photo = /\.(?:png|jpe?g|webp|gif|avif)$/i.test(item.file.name),
            video = /\.mp4$/i.test(item.file.name),
            Icon = photo ? Image : video ? Film : FileText;
          return (
            <Item asChild key={key(item)} className="flex-nowrap px-0">
              <li data-file-id={key(item)}>
                <ItemMedia>
                  <Icon className="size-4 text-muted-foreground" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="break-all">{item.file.name}</ItemTitle>
                  <ItemDescription className="text-xs">{fileSize(item.file.size)}</ItemDescription>
                </ItemContent>
                {(photo || video || (documentFormat(item.file.name) && openDocument)) && (
                  <IconButton
                    label={`View ${item.file.name}`}
                    icon={Eye}
                    disabled={!!busy}
                    onClick={() => void view(item)}
                  />
                )}
                <IconButton
                  label={`Download ${item.file.name}`}
                  icon={Download}
                  disabled={!!busy}
                  onClick={() => void download(item)}
                />
              </li>
            </Item>
          );
        })}
      </ul>
      {!!cursor && (
        <Button variant="quiet" disabled={more} onClick={() => void loadMore()}>
          Load more
        </Button>
      )}
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
              onDownload={() => save(viewer.blob, viewer.name)}
            />
          </Suspense>
        )}
      </Dialog>
    </div>
  );
}
