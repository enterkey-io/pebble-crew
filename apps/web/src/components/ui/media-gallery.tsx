import { useEffect, useRef, useState } from 'react';
import type { PhotoSize } from '@hermes-client/protocol';
import ImageViewerContent from './image-viewer';
import { LoadingBar } from './loading-bar';
import type { GalleryItem } from '../../chat/media-gallery-context';
import { saveMedia } from '../../chat/media-save';

type Loaded = { url: string; blob: Blob } | 'error';
type Size = PhotoSize | 'full';
/** Photos whose chat-sized copy is kept loaded on each side, for swipes. */
const NEAR = 2;
/** Thumbnails loaded on each side of the current photo. */
const STRIP = 12;
const slot = (size: Size, key: string) => `${size}:${key}`;

/** Full-screen photo viewer with swipe, a thumbnail row and save-to-Photos.
 *  The chat-sized copy shows at once; only the current photo loads its original. */
export default function MediaGalleryContent({
  items,
  initialIndex,
  open,
  onOpenChange,
}: {
  items: GalleryItem[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(items.length - 1, initialIndex)));
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const cache = useRef(new Map<string, Loaded>());
  const pending = useRef(new Map<string, AbortController>());
  const borrowed = useRef(new Set<string>());
  const strip = useRef<HTMLDivElement>(null);
  const current = items[index];

  useEffect(() => {
    const publish = () => setLoaded(Object.fromEntries(cache.current));
    // Most important first: this photo, its neighbours, then thumbnails outward.
    const wanted: [GalleryItem, Size][] = [];
    const at = (position: number) => items[position];
    if (at(index)) wanted.push([at(index)!, 'preview'], [at(index)!, 'full']);
    for (let step = 1; step <= NEAR; step++)
      for (const position of [index + step, index - step])
        if (at(position)) wanted.push([at(position)!, 'preview']);
    if (items.length > 1)
      for (let step = 0; step <= STRIP; step++)
        for (const position of step ? [index + step, index - step] : [index])
          if (at(position)) wanted.push([at(position)!, 'thumb']);
    const keep = new Set(wanted.map(([item, size]) => slot(size, item.key)));
    for (const [item, size] of wanted) {
      const id = slot(size, item.key);
      if (cache.current.has(id) || pending.current.has(id)) continue;
      // The photo that was tapped is already on screen; reuse its chat copy. The chat
      // keeps that URL alive while its viewer is open.
      const held =
        size === 'preview' && item.key === items[initialIndex]?.key ? item.cached?.() : undefined;
      if (held) {
        borrowed.current.add(held.url);
        cache.current.set(id, held);
        continue;
      }
      const controller = new AbortController();
      pending.current.set(id, controller);
      void item
        .load(controller.signal, size === 'full' ? undefined : size)
        .then((blob): Loaded => ({ url: URL.createObjectURL(blob), blob }))
        .catch((): Loaded => 'error')
        .then((value) => {
          pending.current.delete(id);
          if (controller.signal.aborted) {
            if (value !== 'error') URL.revokeObjectURL(value.url);
            return;
          }
          cache.current.set(id, value);
          publish();
        });
    }
    publish();
    // Stop loading what the owner swiped away from, and let go of originals
    // they have left behind; their smaller copies stay.
    for (const [id, controller] of pending.current)
      if (!keep.has(id)) {
        controller.abort();
        pending.current.delete(id);
      }
    let released = false;
    for (const [id, value] of cache.current)
      if (id.startsWith('full:') && !keep.has(id)) {
        if (value !== 'error') URL.revokeObjectURL(value.url);
        cache.current.delete(id);
        released = true;
      }
    if (released) publish();
  }, [items, index, initialIndex]);

  useEffect(() => {
    const cached = cache.current,
      inflight = pending.current,
      shared = borrowed.current;
    return () => {
      for (const controller of inflight.values()) controller.abort();
      for (const value of cached.values())
        if (value !== 'error' && !shared.has(value.url)) URL.revokeObjectURL(value.url);
    };
  }, []);

  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [index]);

  if (!current) return null;
  const ready = (size: Size, item = current) => {
    const value = loaded[slot(size, item.key)];
    return value && value !== 'error' ? value : undefined;
  };
  const full = loaded[slot('full', current.key)];
  // Sharpest copy available: the original, the chat copy, or a thumbnail meanwhile.
  const shown = ready('full') ?? ready('preview') ?? ready('thumb');
  const failed = full === 'error' && !ready('preview');
  const move = (direction: 1 | -1) =>
    setIndex((value) => Math.max(0, Math.min(items.length - 1, value + direction)));
  const item = current;
  const save = () => {
    const original = ready('full', item);
    if (original) {
      void saveMedia(original.blob, item.name);
      return;
    }
    void item
      .load(new AbortController().signal)
      .then((blob) => saveMedia(blob, item.name))
      .catch(() => undefined);
  };

  return (
    <ImageViewerContent
      src={shown && !failed ? shown.url : ''}
      photoKey={current.key}
      alt={current.title || current.name}
      open={open}
      onOpenChange={onOpenChange}
      {...(shown && !failed ? { onSave: save } : {})}
      {...(items.length > 1 ? { onSwipe: move } : {})}
      caption={current.title}
      placeholder={
        failed ? (
          <p className="text-sm text-white/80">This photo could not be loaded.</p>
        ) : !shown ? (
          <LoadingBar active label="Loading photo" />
        ) : undefined
      }
      strip={
        items.length > 1 ? (
          <div
            ref={strip}
            className="flex max-w-[calc(100vw-2rem)] gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
            role="group"
            aria-label="Photos"
          >
            {items.map((entry, position) => {
              const thumb = ready('thumb', entry) ?? ready('preview', entry);
              return (
                <button
                  key={entry.key}
                  type="button"
                  aria-label={`Show ${entry.title || entry.name}`}
                  aria-current={position === index}
                  className={`size-14 shrink-0 overflow-hidden rounded-xl bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${position === index ? 'ring-2 ring-white' : 'opacity-80'}`}
                  onClick={() => setIndex(position)}
                >
                  {thumb && (
                    <img
                      src={thumb.url}
                      alt=""
                      draggable={false}
                      decoding="async"
                      className="size-full object-cover"
                    />
                  )}
                </button>
              );
            })}
          </div>
        ) : undefined
      }
    />
  );
}
