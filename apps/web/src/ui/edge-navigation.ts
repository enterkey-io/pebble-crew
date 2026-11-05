import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** Own only a deliberate, single-finger rightward swipe from the leading edge. */
export function useEdgeNavigation(
  container: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onBack?: () => void,
) {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const node = container.current;
    if (!node || !enabled) return;
    const installed =
      matchMedia('(display-mode: standalone)').matches ||
      Reflect.get(navigator, 'standalone') === true;
    if (!installed) return;
    let gesture: { x: number; y: number; rightward: boolean } | undefined;
    const cancel = () => {
      gesture = undefined;
    };
    const start = (event: TouchEvent) => {
      cancel();
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1 || touch.clientX > 24) return;
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"]')
      )
        return;
      gesture = { x: touch.clientX, y: touch.clientY, rightward: false };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) return cancel();
      const x = touch.clientX - gesture.x,
        y = Math.abs(touch.clientY - gesture.y);
      if (x < -8 || (y > 8 && y > x)) return cancel();
      if (x > 12 && x > y * 1.5) {
        gesture.rightward = true;
        if (event.cancelable) event.preventDefault();
      }
    };
    const end = (event: TouchEvent) => {
      const current = gesture;
      cancel();
      const touch = event.changedTouches[0];
      if (!current?.rightward || !touch) return;
      const distance = touch.clientX - current.x;
      if (distance >= Math.max(60, node.clientWidth * 0.15)) back.current?.();
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
  }, [container, enabled]);
}
