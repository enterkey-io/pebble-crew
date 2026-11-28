import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { Minus, Plus, Scan, X, Play, Pause, Volume2, VolumeX, Download } from 'lucide-react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { DialogContent, DialogTitle, DialogDescription } from './dialog';
import { IconButton } from './icon-button';
import { Slider } from './slider';
import { useOverlayHistory } from '../../ui/overlay-history';

const controlClassName =
  'text-white hover:bg-white/10 hover:text-white focus-visible:ring-white/50';

export default function ImageViewerContent({
  src,
  alt,
  open,
  onOpenChange,
  kind = 'image',
  initialTime = 0,
  onDownload,
  onSave,
  onSwipe,
  caption,
  strip,
  placeholder,
  photoKey,
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: 'image' | 'video';
  initialTime?: number;
  onDownload?: () => void;
  /** Save an image to the device (share sheet on iPhone). */
  onSave?: () => void;
  /** Move to the previous (-1) or next (1) item when not zoomed in. */
  onSwipe?: (direction: 1 | -1) => void;
  caption?: string | undefined;
  strip?: ReactNode;
  /** Shown instead of the image while it loads or when it failed. */
  placeholder?: ReactNode;
  /** Identifies the photo. A sharper copy of the same photo keeps the zoom. */
  photoKey?: string;
}) {
  const swipe = useRef<{ x: number; y: number; time: number; moved: boolean } | null>(null);
  const zoomed = () => (controls.current?.instance.state.scale ?? 1) > 1.01;
  const controls = useRef<ReactZoomPanPinchRef>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const backdropTouch = useRef<{ x: number; y: number } | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [failed, setFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const video = kind === 'video';
  useEffect(() => {
    if (!open) {
      setVideoReady(false);
      setPlaying(false);
      setFailed(false);
    }
  }, [open]);
  // A gallery swaps the photo in place; start each one unzoomed.
  const shownPhoto = photoKey ?? src;
  const centered = useRef<string | undefined>(undefined);
  useEffect(() => {
    void controls.current?.centerView(1, 0);
  }, [shownPhoto]);
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
      className="dark"
      showCloseButton={false}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        surface.current
          ?.querySelector<HTMLElement>('[aria-label$="canvas"]')
          ?.focus({ preventScroll: true });
      }}
      onKeyDownCapture={(event) => {
        if (
          onSwipe &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
          !zoomed()
        ) {
          event.preventDefault();
          event.stopPropagation();
          onSwipe(event.key === 'ArrowRight' ? 1 : -1);
          return;
        }
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
        centerZoomedOut
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
            'aria-label': video ? 'Video canvas' : 'Image canvas',
            onPointerDownCapture: () => (dragged.current = false),
            onTouchStartCapture: (event) => {
              const point = event.touches[0];
              swipe.current =
                event.touches.length === 1 && point
                  ? { x: point.clientX, y: point.clientY, time: Date.now(), moved: false }
                  : null;
              backdropTouch.current =
                event.target === event.currentTarget && event.touches.length === 1 && point
                  ? { x: point.clientX, y: point.clientY }
                  : null;
            },
            onTouchMoveCapture: (event) => {
              const start = backdropTouch.current;
              const point = event.touches[0];
              const gesture = swipe.current;
              if (
                gesture &&
                point &&
                Math.hypot(point.clientX - gesture.x, point.clientY - gesture.y) > 10
              ) {
                gesture.moved = true;
              }
              if (event.touches.length !== 1) swipe.current = null;
              if (
                start &&
                (event.touches.length !== 1 ||
                  !point ||
                  Math.hypot(point.clientX - start.x, point.clientY - start.y) > 8)
              )
                backdropTouch.current = null;
            },
            onTouchCancel: () => {
              backdropTouch.current = null;
              swipe.current = null;
            },
            onTouchEnd: (event) => {
              const tap = backdropTouch.current;
              backdropTouch.current = null;
              const gesture = swipe.current;
              swipe.current = null;
              const point = event.changedTouches[0];
              if (onSwipe && gesture && point && event.touches.length === 0 && !zoomed()) {
                const dx = point.clientX - gesture.x,
                  dy = point.clientY - gesture.y;
                if (
                  Math.abs(dx) > 50 &&
                  Math.abs(dx) > Math.abs(dy) * 1.5 &&
                  Date.now() - gesture.time < 800
                ) {
                  event.preventDefault();
                  onSwipe(dx < 0 ? 1 : -1);
                  return;
                }
              }
              if (tap && event.touches.length === 0) {
                event.preventDefault();
                onOpenChange(false);
              }
            },
            onClick: (event) => {
              if (event.target === event.currentTarget && !dragged.current) onOpenChange(false);
            },
          }}
        >
          {video ? (
            <video
              ref={player}
              src={src}
              playsInline
              muted={muted}
              preload="metadata"
              aria-label={alt}
              className={`max-h-[calc(var(--app-viewport-height,100dvh)-10rem)] max-w-[calc(100vw-2rem)] select-none ${videoReady ? 'opacity-100' : 'opacity-0'}`}
              onLoadedMetadata={() => {
                const node = player.current;
                if (node) {
                  setDurationSeconds(Number.isFinite(node.duration) ? node.duration : 0);
                  node.currentTime = Math.min(initialTime, node.duration || 0);
                  setTime(node.currentTime);
                }
              }}
              onLoadedData={() =>
                requestAnimationFrame(() => {
                  void controls.current?.centerView(1, 0).then(() => setVideoReady(true));
                })
              }
              onTimeUpdate={() => setTime(player.current?.currentTime ?? 0)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => setFailed(true)}
            />
          ) : placeholder || !src ? (
            <div className="flex h-[50vh] w-[min(80vw,32rem)] items-center justify-center">
              {placeholder}
            </div>
          ) : (
            <img
              src={src}
              alt={alt}
              draggable={false}
              // The zoom library turns off pointer events and the touch callout for
              // images inside it. Restore both so a long press opens the system
              // image menu (Save to Photos, Share, Copy) like any web page photo.
              style={{ WebkitTouchCallout: 'default', pointerEvents: 'auto' }}
              className={`${strip || caption ? 'max-h-[calc(var(--app-viewport-height,100dvh)-14rem)]' : 'max-h-[calc(var(--app-viewport-height,100dvh)-8rem)]'} max-w-[calc(100vw-2rem)] rounded-2xl`}
              onLoad={() => {
                if (centered.current === shownPhoto) return;
                centered.current = shownPhoto;
                void controls.current?.centerView(1, 0);
              }}
            />
          )}
        </TransformComponent>
        <div
          className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 p-1 backdrop-blur-md"
          role="group"
          aria-label={video ? 'Video controls' : 'Image controls'}
        >
          {video && (
            <>
              <IconButton
                className={controlClassName}
                label={playing ? 'Pause video' : 'Play video'}
                icon={playing ? Pause : Play}
                size="icon-lg"
                disabled={failed}
                onClick={() => {
                  if (player.current?.paused)
                    void player.current.play().catch(() => setFailed(true));
                  else player.current?.pause();
                }}
              />
              <IconButton
                className={controlClassName}
                label={muted ? 'Unmute video' : 'Mute video'}
                icon={muted ? VolumeX : Volume2}
                size="icon-lg"
                onClick={() => {
                  if (player.current) {
                    player.current.muted = !muted;
                    setMuted(!muted);
                  }
                }}
              />
            </>
          )}
          <IconButton
            className={controlClassName}
            label="Zoom out"
            icon={Minus}
            size="icon-lg"
            onClick={() => zoomBy(-0.35)}
          />
          <IconButton
            className={controlClassName}
            label={video ? 'Fit video' : 'Fit image'}
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
          {(onSave ?? onDownload) && (
            <IconButton
              className={controlClassName}
              label={video ? 'Save video' : 'Save photo'}
              icon={Download}
              size="icon-lg"
              onClick={onSave ?? onDownload}
            />
          )}
        </div>
      </TransformWrapper>
      {video && (
        <div className="absolute bottom-[max(5rem,calc(env(safe-area-inset-bottom)+4rem))] left-1/2 w-[min(440px,calc(100vw-3rem))] -translate-x-1/2 rounded-full bg-black/60 px-4 py-3 backdrop-blur-md">
          {failed ? (
            <p className="text-center text-sm text-white/80">
              This browser can’t play this video. Download it to watch.
            </p>
          ) : (
            <Slider
              aria-label="Video position"
              min={0}
              max={durationSeconds || 1}
              step={0.1}
              value={[time]}
              disabled={!durationSeconds}
              onValueChange={(values) => {
                if (player.current && values[0] !== undefined) {
                  player.current.currentTime = values[0];
                  setTime(values[0]);
                }
              }}
            />
          )}
        </div>
      )}
      {(caption || strip) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(4.5rem,calc(env(safe-area-inset-bottom)+3.5rem))] flex flex-col items-center gap-3 px-4">
          {caption && (
            <p
              aria-hidden="true"
              className="gallery-caption max-w-full truncate text-center text-base text-white/85"
            >
              {caption}
            </p>
          )}
          {strip && <div className="pointer-events-auto max-w-full">{strip}</div>}
        </div>
      )}
      <IconButton
        className={`absolute top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] rounded-full bg-black/40 backdrop-blur-md ${controlClassName}`}
        label={video ? 'Close video' : 'Close image'}
        icon={X}
        size="icon-lg"
        onClick={() => onOpenChange(false)}
      />
    </DialogContent>
  );
}
