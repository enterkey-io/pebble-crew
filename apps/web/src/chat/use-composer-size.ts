import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** Measures the text in a detached copy of the field. Collapsing the field itself
 *  for a moment makes the conversation pane taller, which pulls its scroll position
 *  down and leaves the messages chasing the composer for several frames. */
function contentHeight(field: HTMLTextAreaElement, width: number) {
  const probe = document.createElement('textarea');
  probe.className = field.className;
  probe.rows = 1;
  probe.tabIndex = -1;
  probe.setAttribute('aria-hidden', 'true');
  probe.value = field.value;
  Object.assign(probe.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: `${width}px`,
    height: '0px',
    minHeight: '0px',
    visibility: 'hidden',
    pointerEvents: 'none',
    overflow: 'hidden',
  });
  field.parentElement!.append(probe);
  const height = probe.scrollHeight;
  probe.remove();
  return height;
}

export function useComposerSize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  conversation: string,
  active: boolean,
) {
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field || !active) return;
    let width = -1;
    const fit = () => {
      width = field.getBoundingClientRect().width;
      if (width <= 0) return;
      if (!field.value) {
        field.style.height = 'auto';
        return;
      }
      const maximum = Number.parseFloat(getComputedStyle(field).maxHeight);
      const height = `${Math.min(contentHeight(field, width), Number.isFinite(maximum) ? maximum : 160)}px`;
      if (field.style.height !== height) field.style.height = height;
    };
    const observer = new ResizeObserver(() => {
      if (field.getBoundingClientRect().width !== width) fit();
    });
    observer.observe(field);
    fit();
    return () => observer.disconnect();
  }, [ref, value, conversation, active]);
}
