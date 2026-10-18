import { useEffect, useRef } from 'react';
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

/** A single width drives both the main boundary and the adjacent panel. */
export function DetailsDock({
  open,
  children,
  onFrame,
}: {
  open: boolean;
  children: ReactNode;
  onFrame: () => void;
}) {
  const phone = useMedia('(max-width:767px)'),
    wide = useMedia('(min-width:1400px)');
  const target = phone ? window.innerWidth : wide ? 320 : 288;
  const reduce = useReducedMotion();
  const width = useMotionValue(open ? target : 0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open && phone) {
      const frame = requestAnimationFrame(() => {
        const activeTab = panel.current?.querySelector<HTMLElement>(
          '[role="tab"][data-state="active"]',
        );
        (activeTab ?? panel.current?.querySelector<HTMLElement>('button'))?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [open, phone]);
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
      className="pc-details-slot"
      aria-label="Conversation details"
      style={{ width }}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="pc-details-fixed" style={{ width: target }}>
        {children}
      </div>
    </motion.aside>
  );
}
