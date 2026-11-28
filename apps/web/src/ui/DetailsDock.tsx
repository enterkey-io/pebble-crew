import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  frame,
  cancelFrame,
} from 'motion/react';
import { useMedia } from './motion';

const widthKey = 'pebble-crew.document-width';
const minimumWidth = 280;
const maximumWidth = 960;

function readDocumentWidth() {
  try {
    const width = Number(localStorage.getItem(widthKey));
    if (width >= minimumWidth && width <= maximumWidth) return width;
  } catch {
    // The viewer can be resized with storage disabled.
  }
}

function rememberDocumentWidth(width?: number) {
  try {
    if (width === undefined) localStorage.removeItem(widthKey);
    else localStorage.setItem(widthKey, String(width));
  } catch {
    // Keep the chosen width in memory when storage is disabled.
  }
}

/** A single width drives both the main boundary and the adjacent panel. */
export function DetailsDock({
  open,
  children,
  onFrame,
  document = false,
  expanded = false,
}: {
  open: boolean;
  children: ReactNode;
  onFrame: () => void;
  document?: boolean;
  expanded?: boolean;
}) {
  const phone = useMedia('(max-width:767px)'),
    wide = useMedia('(min-width:1400px)');
  const [preferred, setPreferred] = useState(readDocumentWidth);
  const [available, setAvailable] = useState(() => window.innerWidth);
  const documentDefault = wide ? 560 : 400;
  const max = Math.min(maximumWidth, available - Math.min(360, Math.round(available * 0.45)));
  const min = Math.min(minimumWidth, max);
  const clamp = (size: number) => Math.min(max, Math.max(min, Math.round(size)));
  const target = phone
    ? window.innerWidth
    : document
      ? clamp(preferred ?? documentDefault)
      : wide
        ? 320
        : 288;
  const reduce = useReducedMotion();
  const width = useMotionValue(open ? target : 0);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const container = panel.current?.parentElement;
    if (!container || phone || !open || !document) return;
    const measure = () => setAvailable(container.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      drag.current = null;
      observer.disconnect();
    };
  }, [phone, open, document]);

  function resize(size: number) {
    const next = clamp(size);
    setPreferred(next);
    width.jump(next);
    return next;
  }

  useEffect(() => {
    if (open && phone && !document) {
      const frame = requestAnimationFrame(() => {
        const activeTab = panel.current?.querySelector<HTMLElement>(
          '[role="tab"][data-state="active"]',
        );
        (activeTab ?? panel.current?.querySelector<HTMLElement>('button'))?.focus({
          preventScroll: true,
        });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [open, phone, document]);
  useEffect(() => {
    const update = () => frame.postRender(onFrame);
    const stop = width.on('change', update);
    return () => {
      stop();
      cancelFrame(onFrame);
    };
  }, [width, onFrame]);
  useEffect(() => {
    const animation = animate(width, open ? target : 0, {
      duration: reduce ? 0 : 0.24,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => animation.stop();
  }, [open, target, reduce, width]);
  return (
    <motion.aside
      ref={panel}
      className="pc-details-slot relative"
      aria-label={expanded ? undefined : document ? 'Document' : 'Conversation details'}
      role={expanded ? 'presentation' : undefined}
      style={{ width }}
      inert={!open}
      aria-hidden={!open}
    >
      {open && document && !phone && !expanded && max > min && (
        <div
          role="separator"
          aria-label="Resize document viewer"
          aria-controls="pebble-document-panel"
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={target}
          aria-valuetext={`${target} pixels`}
          tabIndex={0}
          className="absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize touch-none before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-sidebar-border hover:before:bg-muted-foreground focus-visible:before:bg-muted-foreground"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus({ preventScroll: true });
            drag.current = { id: event.pointerId, x: event.clientX, width: width.get() };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start?.id === event.pointerId) resize(start.width + start.x - event.clientX);
          }}
          onLostPointerCapture={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            drag.current = null;
            rememberDocumentWidth(clamp(width.get()));
          }}
          onDoubleClick={() => {
            setPreferred(undefined);
            width.jump(clamp(documentDefault));
            rememberDocumentWidth();
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 64 : 16;
            const size =
              event.key === 'ArrowLeft'
                ? target + step
                : event.key === 'ArrowRight'
                  ? target - step
                  : event.key === 'Home'
                    ? min
                    : event.key === 'End'
                      ? max
                      : undefined;
            if (size === undefined) return;
            event.preventDefault();
            rememberDocumentWidth(resize(size));
          }}
        />
      )}
      <div
        id={document ? 'pebble-document-panel' : undefined}
        className="pc-details-fixed"
        data-expanded={expanded || undefined}
        role={expanded ? 'dialog' : undefined}
        aria-label={expanded ? 'Document' : undefined}
        aria-modal={expanded || undefined}
        style={{ width: expanded ? '100%' : target }}
      >
        {children}
      </div>
    </motion.aside>
  );
}
