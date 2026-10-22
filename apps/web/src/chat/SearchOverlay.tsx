import { LoadingBar } from '../components/ui/loading-bar';
import { useEffect, useRef, useState } from 'react';
import type { SessionClient } from '@hermes-client/protocol';
import { Search, MessageSquare, Users, FileText, CalendarClock } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '../components/ui/command';
import type { Row } from '../conversation';
import { Button } from '../components/ui/button';
import { useOverlayHistory } from '../ui/overlay-history';

type Hit = {
  id: string;
  kind: 'pebble' | 'message' | 'crew' | 'file' | 'routine';
  title: string;
  snippet: string;
  profile?: string;
  room?: Row;
  item_id?: string;
  bot_id?: string;
};
function result(value: unknown): { hits: Hit[]; coverage: string } {
  if (
    !value ||
    typeof value !== 'object' ||
    !('hits' in value) ||
    !Array.isArray(value.hits) ||
    value.hits.length > 100 ||
    !('coverage' in value) ||
    typeof value.coverage !== 'string'
  )
    throw new Error('Invalid search response');
  const hits = value.hits.map((row: unknown): Hit => {
    if (
      !row ||
      typeof row !== 'object' ||
      !('id' in row) ||
      typeof row.id !== 'string' ||
      !('kind' in row) ||
      !['pebble', 'message', 'crew', 'file', 'routine'].includes(String(row.kind)) ||
      !('title' in row) ||
      typeof row.title !== 'string' ||
      !('snippet' in row) ||
      typeof row.snippet !== 'string'
    )
      throw new Error('Invalid search hit');
    const kind =
      row.kind === 'pebble'
        ? 'pebble'
        : row.kind === 'crew'
          ? 'crew'
          : row.kind === 'file'
            ? 'file'
            : row.kind === 'routine'
              ? 'routine'
              : 'message';
    return {
      id: row.id,
      kind,
      title: row.title,
      snippet: row.snippet,
      ...('item_id' in row && typeof row.item_id === 'string' ? { item_id: row.item_id } : {}),
      ...('bot_id' in row && typeof row.bot_id === 'string' ? { bot_id: row.bot_id } : {}),
      ...('profile' in row && typeof row.profile === 'string' ? { profile: row.profile } : {}),
      ...('room' in row && row.room && typeof row.room === 'object'
        ? { room: row.room as Row }
        : {}),
    };
  });
  return { hits, coverage: value.coverage };
}
export function SearchOverlay({
  open,
  onClose,
  client,
  onBot,
  onRoom,
}: {
  open: boolean;
  onClose: () => void;
  client: SessionClient;
  onBot: (profile: string, detail?: { tab: 'files' | 'routines'; id: string }) => void;
  onRoom: (room: Row) => void;
}) {
  const [query, setQuery] = useState(''),
    [hits, setHits] = useState<Hit[]>([]),
    [busy, setBusy] = useState(false),
    [coverage, setCoverage] = useState(''),
    [error, setError] = useState('');
  const generation = useRef(0);
  const [preview, setPreview] = useState<{
    hit: Hit;
    title: string;
    text: string;
    busy: boolean;
  } | null>(null);
  const previewGeneration = useRef(0);
  function closePreview() {
    previewGeneration.current++;
    setPreview(null);
  }
  useOverlayHistory(open, onClose);
  useOverlayHistory(!!preview, closePreview);
  async function select(hit: Hit) {
    if (
      (hit.room && (hit.kind !== 'message' || !hit.item_id)) ||
      hit.kind === 'pebble' ||
      !hit.item_id ||
      (!hit.room && (!hit.bot_id || !hit.profile))
    ) {
      onClose();
      if (hit.room) onRoom(hit.room);
      else if (hit.profile) onBot(hit.profile);
      return;
    }
    const ticket = ++previewGeneration.current;
    setPreview({ hit, title: hit.title, text: '', busy: true });
    onClose();
    try {
      const value = await client.invoke(
        'search.context',
        hit.room
          ? {
              kind: 'room-message',
              room_id: hit.room.room_id,
              created_at: String(hit.room.created_at),
              item_id: hit.item_id,
            }
          : {
              profile: hit.profile,
              bot_id: hit.bot_id,
              kind: hit.kind,
              item_id: hit.item_id,
              query,
            },
      );
      if (ticket !== previewGeneration.current) return;
      if (
        !value ||
        typeof value !== 'object' ||
        !('title' in value) ||
        typeof value.title !== 'string' ||
        !('text' in value) ||
        typeof value.text !== 'string'
      )
        throw new Error();
      setPreview({ hit, title: value.title, text: value.text, busy: false });
    } catch {
      if (ticket === previewGeneration.current)
        setPreview({
          hit,
          title: hit.title,
          text: 'This result is no longer available. Search again to refresh it.',
          busy: false,
        });
    }
  }
  useEffect(() => {
    if (open) {
      setQuery('');
      setHits([]);
      setCoverage('');
      setError('');
    }
  }, [open]);
  useEffect(() => {
    const ticket = ++generation.current;
    setHits([]);
    setError('');
    if (!open || !query.trim()) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      void client
        .invoke('search.query', { query: query.trim() })
        .then((value) => {
          if (generation.current !== ticket) return;
          const data = result(value);
          setHits(data.hits);
          setCoverage(data.coverage);
        })
        .catch(() => {
          if (generation.current === ticket)
            setError('Search is unavailable. Try again in a moment.');
        })
        .finally(() => {
          if (generation.current === ticket) setBusy(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [query, open, client]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) onClose();
        else
          document.querySelector<HTMLButtonElement>('[aria-label="Search Pebble Crew"]')?.click();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  const icons = {
    pebble: Search,
    message: MessageSquare,
    crew: Users,
    file: FileText,
    routine: CalendarClock,
  };
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) onClose();
        }}
      >
        <DialogContent
          className="pc-search gap-0 overflow-hidden p-0 sm:max-w-[640px]"
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLElement>('[aria-label="Search Pebble Crew"]')?.focus();
          }}
        >
          <DialogTitle className="sr-only">Search Pebble Crew</DialogTitle>
          <DialogDescription className="sr-only">
            Search on your own Hermes server.
          </DialogDescription>
          <Command shouldFilter={false} className="bg-card">
            <CommandInput
              variant="search"
              placeholder="Search Pebble Crew…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-[min(480px,60dvh)] px-3 pb-3">
              {busy ? (
                <p className="search-status" role="status">
                  Searching…
                </p>
              ) : error ? (
                <p className="search-status error" role="alert">
                  {error}
                </p>
              ) : !query.trim() ? (
                <p className="search-status">Messages, pebbles, crews, files and routines</p>
              ) : (
                <>
                  <CommandEmpty>No results</CommandEmpty>
                  <CommandGroup>
                    {hits.map((hit) => {
                      const Icon = icons[hit.kind];
                      return (
                        <CommandItem
                          className="min-h-12 gap-3 rounded-lg px-3 py-2"
                          key={hit.id}
                          value={hit.id}
                          onSelect={() => void select(hit)}
                        >
                          <Icon />
                          <span>
                            <strong>{hit.title}</strong>
                            <small>{hit.snippet}</small>
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
          <footer className="pc-search-footer">
            <span>{query.trim() ? coverage : 'Search stays on your server'}</span>
            <kbd>esc</kbd>
          </footer>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(value) => {
          if (!value) closePreview();
        }}
      >
        <DialogContent
          className="product-dialog search-result"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLElement>('[aria-label="Search Pebble Crew"]')?.focus();
          }}
        >
          <DialogTitle>{preview?.title}</DialogTitle>
          <DialogDescription className="sr-only">Saved on your Hermes</DialogDescription>
          <LoadingBar active={preview?.busy ?? false} label="Loading search result" />
          <div className="search-result-text">{preview?.text}</div>
          <div className="form-actions">
            <Button variant="secondary" onClick={closePreview}>
              Close
            </Button>
            <Button
              disabled={preview?.busy}
              onClick={() => {
                const hit = preview?.hit;
                if (!hit) return;
                closePreview();
                if (hit.room) {
                  onRoom(hit.room);
                  return;
                }
                if (hit.profile)
                  onBot(
                    hit.profile,
                    (hit.kind === 'file' || hit.kind === 'routine') && hit.item_id
                      ? { tab: hit.kind === 'file' ? 'files' : 'routines', id: hit.item_id }
                      : undefined,
                  );
              }}
            >
              {preview?.hit.kind === 'file'
                ? 'Open files'
                : preview?.hit.kind === 'routine'
                  ? 'Open routines'
                  : 'Open conversation'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
