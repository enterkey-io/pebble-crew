import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** A deliberate single-finger edge swipe moves between the two retained phone pages. */
export function useEdgeNavigation(
  container: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onNavigate?: () => void,
  direction: 'to-list' | 'to-chat' = 'to-list',
) {
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  useEffect(() => {
    const node = container.current;
    if (!node || !enabled) return;
    const installed =
      matchMedia('(display-mode: standalone)').matches ||
      Reflect.get(navigator, 'standalone') === true;
    if (!installed) return;
    const sign = direction === 'to-list' ? 1 : -1;
    let gesture: { x: number; y: number; accepted: boolean } | undefined;
    const cancel = () => {
      gesture = undefined;
    };
    const start = (event: TouchEvent) => {
      cancel();
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) return;
      const bounds = node.getBoundingClientRect();
      if (
        direction === 'to-list'
          ? touch.clientX > bounds.left + 24
          : touch.clientX < bounds.right - 24
      )
        return;
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]',
        )
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"]')
      )
        return;
      gesture = { x: touch.clientX, y: touch.clientY, accepted: false };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) return cancel();
      const x = (touch.clientX - gesture.x) * sign,
        y = Math.abs(touch.clientY - gesture.y);
      if (x < -8 || (y > 8 && y > x)) return cancel();
      if (x > 12 && x > y * 1.5) {
        gesture.accepted = true;
        if (event.cancelable) event.preventDefault();
      }
    };
    const end = (event: TouchEvent) => {
      const current = gesture;
      cancel();
      const touch = event.changedTouches[0];
      if (!current?.accepted || !touch) return;
      const distance = (touch.clientX - current.x) * sign;
      if (distance >= Math.max(60, node.clientWidth * 0.15)) navigate.current?.();
    };
    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchmove', move, { passive: false });
    node.addEventListener('touchend', end, { passive: true });
    node.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', cancel);
    };
  }, [container, enabled, direction]);
}
