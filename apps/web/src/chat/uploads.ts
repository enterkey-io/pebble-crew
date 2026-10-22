import { useEffect, useRef, useState } from 'react';
import type { SessionClient } from '@hermes-client/protocol';
import { safeError } from '@hermes-client/core';
export type DraftFile = {
  key: string;
  id?: string;
  name: string;
  size: number;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
  file?: File | undefined;
};
export function useUploads(
  client: SessionClient | undefined,
  conversation: string,
  sessionId: string | undefined,
) {
  const [drafts, setDrafts] = useState<Record<string, DraftFile[]>>({});
  const latest = useRef(drafts);
  latest.current = drafts;
  const controllers = useRef(new Map<string, AbortController>());
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      controllers.current.forEach((c) => c.abort());
      controllers.current.clear();
    },
    [client],
  );
  const update = (target: string, key: string, patch: Partial<DraftFile>) =>
    setDrafts((old) => ({
      ...old,
      [target]: (old[target] ?? []).map((f) => (f.key === key ? { ...f, ...patch } : f)),
    }));
  async function upload(target: string, sid: string, entry: DraftFile, file: File) {
    if (!client) return;
    const controller = new AbortController();
    controllers.current.set(entry.key, controller);
    update(target, entry.key, { status: 'uploading', error: '', file });
    try {
      const value = await client.uploadFile(sid, file, controller.signal);
      update(target, entry.key, { id: value.id, status: 'ready', file: undefined });
    } catch (e) {
      update(target, entry.key, {
        status: 'error',
        error: controller.signal.aborted
          ? 'Upload paused. Try again when connected.'
          : safeError(e).message,
        file,
      });
    } finally {
      controllers.current.delete(entry.key);
    }
  }
  function add(files: File[]) {
    if (!client || !sessionId || !conversation) return;
    setError('');
    const current = latest.current[conversation] ?? [],
      total = current.reduce((n, f) => n + f.size, 0) + files.reduce((n, f) => n + f.size, 0);
    if (
      current.length + files.length > 5 ||
      total > 25 * 1024 * 1024 ||
      files.some((f) => f.size > 10 * 1024 * 1024 || !f.size)
    ) {
      setError('Attach up to 5 files, 10 MB each and 25 MB in total.');
      return;
    }
    const entries = files.map((file) => ({
      key: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      status: 'uploading' as const,
      file,
    }));
    const target = conversation,
      sid = sessionId;
    const next = { ...latest.current, [target]: [...current, ...entries] };
    latest.current = next;
    setDrafts(next);
    for (let i = 0; i < entries.length; i++) void upload(target, sid, entries[i]!, files[i]!);
  }
  function remove(entry: DraftFile) {
    controllers.current.get(entry.key)?.abort();
    controllers.current.delete(entry.key);
    setDrafts((old) => ({
      ...old,
      [conversation]: (old[conversation] ?? []).filter((f) => f.key !== entry.key),
    }));
    if (entry.id && client && sessionId)
      void client
        .invoke('files.remove', { session_id: sessionId, id: entry.id })
        .catch(() => undefined);
  }
  function retry(entry: DraftFile) {
    if (sessionId && entry.file) void upload(conversation, sessionId, entry, entry.file);
  }
  function sent(target: string, ids: string[]) {
    setDrafts((old) => ({
      ...old,
      [target]: (old[target] ?? []).filter((f) => !f.id || !ids.includes(f.id)),
    }));
  }
  const files = drafts[conversation] ?? [];
  return {
    files,
    add,
    remove,
    retry,
    sent,
    error,
    ready: files.every((f) => f.status === 'ready'),
  };
}
