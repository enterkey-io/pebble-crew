import { useEffect, useState } from 'react';
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
/** Explicit user scrolling only. History restoration deliberately does not use this. */
export function scrollToLatest(
  node: HTMLElement,
  onDone: () => void,
  onCancel: () => void = () => {},
) {
  // Rows render lazily (content-visibility) with placeholder heights, and phone
  // momentum can still be moving the pane. Both move the bottom after the first
  // pass, so keep holding the bottom until its position stops changing.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = node.scrollTop,
    began = performance.now();
  let frame = 0,
    stopped = false,
    stable = 0,
    settling = 0,
    lastHeight = -1;
  const bottom = () => node.scrollHeight - node.clientHeight;
  const cancel = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    cleanup();
    onCancel();
  };
  const cleanup = () => {
    node.removeEventListener('wheel', cancel);
    node.removeEventListener('touchstart', cancel);
    node.removeEventListener('keydown', cancel);
  };
  node.addEventListener('wheel', cancel, { passive: true });
  node.addEventListener('touchstart', cancel, { passive: true });
  node.addEventListener('keydown', cancel);
  const settle = () => {
    if (stopped) return;
    node.scrollTop = bottom();
    const height = node.scrollHeight;
    const atBottom = bottom() - node.scrollTop <= 1;
    stable = height === lastHeight && atBottom ? stable + 1 : 0;
    lastHeight = height;
    if (stable >= 4 || ++settling > 90) {
      cleanup();
      onDone();
    } else frame = requestAnimationFrame(settle);
  };
  const step = (now: number) => {
    if (stopped) return;
    const t = reduced ? 1 : Math.min(1, (now - began) / 240);
    node.scrollTop = start + (bottom() - start) * (1 - Math.pow(1 - t, 3));
    frame = requestAnimationFrame(t < 1 ? step : settle);
  };
  if (reduced) {
    node.scrollTop = bottom();
    frame = requestAnimationFrame(settle);
  } else frame = requestAnimationFrame(step);
  return cancel;
}
