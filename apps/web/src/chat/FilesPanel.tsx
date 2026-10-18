import { Button } from '../components/ui/button';
import { useEffect, useState } from 'react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { Notice } from '../ui/primitives';
import { LoadingBar } from '../components/ui/loading-bar';
export type { SharedConversationFile as SharedFile } from '@hermes-client/protocol';
import type { SharedConversationFile as SharedFile } from '@hermes-client/protocol';
import { ConversationDomain } from '@hermes-client/protocol';
import { Item, ItemContent, ItemTitle, ItemDescription } from '../components/ui/item';
import { IconButton } from '../components/ui/icon-button';
import { Download } from 'lucide-react';
export function fileSize(size: number) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.ceil(size / 1024)} KB`
      : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
export function FilesPanel({
  client,
  sessionId,
  version,
  focusId,
}: {
  client: BotBridgeClient;
  sessionId: string;
  version: number;
  focusId?: string | undefined;
}) {
  const [files, setFiles] = useState<SharedFile[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState('');
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    void new ConversationDomain(client)
      .files(sessionId)
      .then((list) => {
        if (live) setFiles(list);
      })
      .catch(() => {
        if (live) setError('Files could not be loaded.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, sessionId, version, retry]);
  useEffect(() => {
    if (focusId && !loading)
      document
        .querySelector<HTMLElement>(`[data-file-id="${CSS.escape(focusId)}"]`)
        ?.scrollIntoView({
          block: 'center',
          behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',
        });
  }, [focusId, loading, files]);
  async function download(file: SharedFile) {
    setBusy(file.id);
    setError('');
    try {
      const blob = await client.downloadFile(sessionId, file.id),
        url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('This file could not be downloaded.');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="files-panel">
      <LoadingBar active={loading} label="Loading files" />
      {error && (
        <Notice error>
          {error}
          <Button variant="secondary" onClick={() => setRetry((x) => x + 1)}>
            Try again
          </Button>
        </Notice>
      )}
      {!loading && !files.length ? (
        <p className="empty-note">No files shared here yet.</p>
      ) : (
        <ul className="file-list">
          {files.map((file) => (
            <Item asChild key={file.id} className="flex-nowrap px-0">
              <li data-file-id={file.id}>
                <ItemContent>
                  <ItemTitle className="break-all">{file.name}</ItemTitle>
                  <ItemDescription className="text-xs">{fileSize(file.size)}</ItemDescription>
                </ItemContent>
                <IconButton
                  label={`Download ${file.name}`}
                  icon={Download}
                  disabled={!!busy}
                  onClick={() => void download(file)}
                />
              </li>
            </Item>
          ))}
        </ul>
      )}
    </div>
  );
}
