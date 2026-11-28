import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Direction = 'above' | 'below';
type Signal = 'unread' | 'attention';
type Destinations = Record<Signal, Record<Direction, HTMLElement | undefined>>;

export function useSidebarSignals({
  scroll,
  header,
  footer,
  enabled,
}: {
  scroll: RefObject<HTMLDivElement | null>;
  header: RefObject<HTMLDivElement | null>;
  footer: RefObject<HTMLElement | null>;
  enabled: boolean;
}) {
  const targets = useRef<Destinations>({
    unread: { above: undefined, below: undefined },
    attention: { above: undefined, below: undefined },
  });
  const [edges, setEdges] = useState({
    unread: { above: false, below: false },
    attention: { above: false, below: false },
  });
  useEffect(() => {
    const list = scroll.current;
    const top = header.current;
    const bottom = footer.current;
    if (!enabled || !list || !top || !bottom) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = list.getBoundingClientRect();
      const start = Math.max(0, bounds.top, top.getBoundingClientRect().bottom);
      const end = Math.min(window.innerHeight, bounds.bottom, bottom.getBoundingClientRect().top);
      const destinations: Destinations = {
        unread: { above: undefined, below: undefined },
        attention: { above: undefined, below: undefined },
      };
      for (const signal of ['unread', 'attention'] as const) {
        const visible = new Set<string>();
        const hidden: { key: string; element: HTMLElement; center: number }[] = [];
        for (const marker of list.querySelectorAll<HTMLElement>(`[data-${signal}-chat]`)) {
          const key =
            signal === 'unread' ? marker.dataset.unreadChat : marker.dataset.attentionChat;
          const element = marker.closest<HTMLElement>('[data-unread-target]');
          if (!key || !element) continue;
          const rect = (element.querySelector('.status-dot') ?? element).getBoundingClientRect();
          if (!rect.height) continue;
          const center = rect.top + rect.height / 2;
          if (center >= start && center <= end) visible.add(key);
          else hidden.push({ key, element, center });
        }
        const next = destinations[signal];
        let nearestAbove = -Infinity;
        let nearestBelow = Infinity;
        for (const item of hidden) {
          if (visible.has(item.key)) continue;
          if (item.center < start && item.center > nearestAbove) {
            nearestAbove = item.center;
            next.above = item.element;
          } else if (item.center > end && item.center < nearestBelow) {
            nearestBelow = item.center;
            next.below = item.element;
          }
        }
      }
      targets.current = destinations;
      const next = {
        unread: { above: !!destinations.unread.above, below: !!destinations.unread.below },
        attention: { above: !!destinations.attention.above, below: !!destinations.attention.below },
      };
      setEdges((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onScroll = (event: Event) => {
      if (event.target === list || event.target === document) schedule();
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-unread-chat', 'data-attention-chat'],
    });
    const resize = new ResizeObserver(schedule);
    for (const element of [list, top, bottom, ...list.children]) resize.observe(element);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    list.addEventListener('transitionend', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', schedule);
      list.removeEventListener('transitionend', schedule);
    };
  }, [enabled, scroll, header, footer]);

  function jump(signal: Signal, direction: Direction) {
    const element = targets.current[signal][direction];
    const list = scroll.current;
    if (!element || !list || !header.current || !footer.current) return;
    const bounds = list.getBoundingClientRect();
    const start = Math.max(0, bounds.top, header.current.getBoundingClientRect().bottom);
    const end = Math.min(
      window.innerHeight,
      bounds.bottom,
      footer.current.getBoundingClientRect().top,
    );
    const rect = element.getBoundingClientRect();
    const options: ScrollToOptions = {
      top: rect.top + rect.height / 2 - (start + end) / 2,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    };
    if (getComputedStyle(list).overflowY === 'visible') window.scrollBy(options);
    else list.scrollBy(options);
  }
  return {
    unread: enabled ? edges.unread : { above: false, below: false },
    attention: enabled ? edges.attention : { above: false, below: false },
    jump,
  };
}

export function SidebarSignalJump({
  kind,
  direction,
  onClick,
}: {
  kind: Signal;
  direction: Direction;
  onClick: () => void;
}) {
  const Arrow = direction === 'above' ? ArrowUp : ArrowDown;
  const label = kind === 'attention' ? 'Needs attention' : 'Unread messages';
  return (
    <div className={`pc-unread-jump pc-unread-jump-${direction}`}>
      <Button
        size="sm"
        className={`rounded-full shadow-sm ${kind === 'attention' ? 'bg-[var(--attention)] text-[var(--background)] hover:bg-[color-mix(in_srgb,var(--attention),var(--foreground)_10%)]' : 'bg-[color-mix(in_srgb,var(--unread),black_18%)] text-white hover:bg-[color-mix(in_srgb,var(--unread),black_28%)]'}`}
        aria-label={`${label} ${direction}`}
        onClick={onClick}
      >
        <Arrow aria-hidden="true" />
        {label}
      </Button>
    </div>
  );
}
