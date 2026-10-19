import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

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
      field.style.height = '0px';
      const maximum = Number.parseFloat(getComputedStyle(field).maxHeight);
      field.style.height = `${Math.min(field.scrollHeight, Number.isFinite(maximum) ? maximum : 160)}px`;
    };
    const observer = new ResizeObserver(() => {
      if (field.getBoundingClientRect().width !== width) fit();
    });
    observer.observe(field);
    fit();
    return () => observer.disconnect();
  }, [ref, value, conversation, active]);
}
