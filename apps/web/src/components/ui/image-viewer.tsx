import { useCallback, useEffect, useRef, useState } from 'react';
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
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: 'image' | 'video';
  initialTime?: number;
  onDownload?: () => void;
}) {
  const controls = useRef<ReactZoomPanPinchRef>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
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
          ) : (
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="max-h-[calc(var(--app-viewport-height,100dvh)-8rem)] max-w-[calc(100vw-2rem)] select-none"
              onLoad={() => void controls.current?.centerView(1, 0)}
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
          {onDownload && (
            <IconButton
              className={controlClassName}
              label="Download video"
              icon={Download}
              size="icon-lg"
              onClick={onDownload}
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
