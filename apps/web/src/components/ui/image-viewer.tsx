import { useCallback, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { Minus, Plus, Scan, X } from 'lucide-react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { DialogContent, DialogTitle, DialogDescription } from './dialog';
import { IconButton } from './icon-button';
import { useOverlayHistory } from '../../ui/overlay-history';

const controlClassName =
  'text-white hover:bg-white/10 hover:text-white focus-visible:ring-white/50';

export default function ImageViewerContent({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const controls = useRef<ReactZoomPanPinchRef>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const reduced = useReducedMotion();
  const duration = reduced ? 0 : 180;
  function zoomBy(step: number) {
    const controller = controls.current;
    if (controller)
      void controller.centerView(
        Math.max(1, Math.min(16, controller.instance.state.scale * Math.exp(step))),
        duration,
      );
  }
  const attachSurface = useCallback((element: HTMLDivElement | null) => {
    surface.current = element;
    if (!element) return;
    function wheel(event: WheelEvent) {
      if (!event.deltaY || (event.target instanceof Element && event.target.closest('button')))
        return;
      const controller = controls.current;
      if (!controller) return;
      event.preventDefault();
      event.stopPropagation();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientHeight : 1);
      const scale = Math.max(
        1,
        Math.min(
          16,
          controller.instance.state.scale * Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.002),
        ),
      );
      void controller.centerView(scale, 0);
    }
    element.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => {
      element.removeEventListener('wheel', wheel, { capture: true });
      surface.current = null;
    };
  }, []);
  useOverlayHistory(open, () => onOpenChange(false));
  return (
    <DialogContent
      ref={attachSurface}
      variant="image"
      showCloseButton={false}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        surface.current
          ?.querySelector<HTMLElement>('[aria-label="Image canvas"]')
          ?.focus({ preventScroll: true });
      }}
      onKeyDownCapture={(event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const action = ['+', '='].includes(event.key)
          ? () => zoomBy(0.35)
          : ['-', '_'].includes(event.key)
            ? () => zoomBy(-0.35)
            : event.key === '0'
              ? () => controls.current?.centerView(1, duration)
              : undefined;
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        void action();
      }}
    >
      <DialogTitle className="sr-only">{alt}</DialogTitle>
      <DialogDescription className="sr-only">
        Scroll or pinch to zoom. Drag to move. Press Escape to close.
      </DialogDescription>
      <TransformWrapper
        ref={controls}
        minScale={1}
        maxScale={16}
        centerOnInit
        disablePadding
        smooth={!reduced}
        keyboard={{ disabled: false, animationTime: duration }}
        doubleClick={{ mode: 'toggle', animationTime: duration }}
        velocityAnimation={{ disabled: !!reduced }}
        autoAlignment={{ animationTime: duration, velocityAlignmentTime: duration }}
        zoomAnimation={{ animationTime: duration }}
        wheel={{ disabled: true }}
        onPanning={() => (dragged.current = true)}
        onPinchStart={() => (dragged.current = true)}
      >
        <TransformComponent
          contentClass="cursor-grab active:cursor-grabbing"
          wrapperStyle={{ width: '100%', height: '100%' }}
          wrapperProps={{
            role: 'group',
            'aria-label': 'Image canvas',
            onPointerDownCapture: () => (dragged.current = false),
            onClick: (event) => {
              if (event.target === event.currentTarget && !dragged.current) onOpenChange(false);
            },
          }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="max-h-[calc(var(--app-viewport-height,100dvh)-8rem)] max-w-[calc(100vw-2rem)] select-none"
            onLoad={() => void controls.current?.centerView(1, 0)}
          />
        </TransformComponent>
        <div
          className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 p-1 backdrop-blur-md"
          role="group"
          aria-label="Image controls"
        >
          <IconButton
            className={controlClassName}
            label="Zoom out"
            icon={Minus}
            size="icon-lg"
            onClick={() => zoomBy(-0.35)}
          />
          <IconButton
            className={controlClassName}
            label="Fit image"
            icon={Scan}
            size="icon-lg"
            onClick={() => void controls.current?.centerView(1, duration)}
          />
          <IconButton
            className={controlClassName}
            label="Zoom in"
            icon={Plus}
            size="icon-lg"
            onClick={() => zoomBy(0.35)}
          />
        </div>
      </TransformWrapper>
      <IconButton
        className={`absolute top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] rounded-full bg-black/40 backdrop-blur-md ${controlClassName}`}
        label="Close image"
        icon={X}
        size="icon-lg"
        onClick={() => onOpenChange(false)}
      />
    </DialogContent>
  );
}
