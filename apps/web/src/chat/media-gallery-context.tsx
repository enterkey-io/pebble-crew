import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { PhotoSize } from '@hermes-client/protocol';

/** One photo the viewer can show. `load` fetches it through the authorized
 *  conversation read; it is only called when the photo is needed. Without a
 *  `size` it returns the original. */
export type GalleryItem = {
  key: string;
  name: string;
  title?: string | undefined;
  load: (signal: AbortSignal, size?: PhotoSize) => Promise<Blob>;
  /** The chat-sized copy the page already holds, shown while the original loads. */
  cached?: () => { blob: Blob; url: string } | undefined;
};

type Entry = { element: HTMLElement; item: GalleryItem };
type Registry = {
  register: (key: string, entry: Entry) => () => void;
  /** Every registered photo in on-screen order. */
  items: () => GalleryItem[];
};

const GalleryContext = createContext<Registry | undefined>(undefined);

/** Collects the photos inside a conversation so opening one can swipe through all of them. */
export function MediaGalleryProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>());
  const register = useCallback((key: string, entry: Entry) => {
    entries.current.set(key, entry);
    return () => {
      if (entries.current.get(key) === entry) entries.current.delete(key);
    };
  }, []);
  const items = useCallback(
    () =>
      [...entries.current.values()]
        .filter((entry) => entry.element.isConnected)
        .sort((a, b) =>
          a.element === b.element
            ? 0
            : a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING
              ? -1
              : 1,
        )
        .map((entry) => entry.item),
    [],
  );
  const value = useMemo(() => ({ register, items }), [register, items]);
  return <GalleryContext.Provider value={value}>{children}</GalleryContext.Provider>;
}

/** Registers one photo while it is mounted. Returns the gallery to open from it. */
export function useGalleryPhoto(
  element: React.RefObject<HTMLElement | null>,
  item: GalleryItem | undefined,
) {
  const registry = useContext(GalleryContext);
  useEffect(() => {
    const node = element.current;
    if (!registry || !item || !node) return;
    return registry.register(item.key, { element: node, item });
  }, [registry, item, element]);
  return useCallback((): { items: GalleryItem[]; index: number } | undefined => {
    if (!item) return;
    const all = registry?.items() ?? [];
    const index = all.findIndex((entry) => entry.key === item.key);
    return index < 0 ? { items: [item], index: 0 } : { items: all, index };
  }, [registry, item]);
}
