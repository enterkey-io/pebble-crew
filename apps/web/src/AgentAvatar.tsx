import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { AvatarView, AvatarScheduler } from './avatar-lab/renderer';
import { BODY_PATHS, COLORS, SHAPES } from './avatar-lab/engine';
import { previewPhoto } from './avatar-lab/photo';
import type { Activity } from './avatar-lab/engine';
import type { Appearance } from '@hermes-client/protocol';
import type { BotBridgeClient } from '@hermes-client/protocol';
let clock: AvatarScheduler | undefined;
let users = 0;
function acquire() {
  if (!clock) clock = new AvatarScheduler();
  users++;
  return clock;
}
function release() {
  if (--users === 0) {
    clock?.destroy();
    clock = undefined;
  }
}
export function AgentAvatar({
  id,
  look,
  state = 'ready',
  orchestrator = false,
  photo,
  client,
  profile,
  large = false,
  revision,
}: {
  id: string;
  look: Appearance;
  state?: Activity;
  orchestrator?: boolean;
  photo?: string;
  client?: BotBridgeClient;
  profile?: string;
  large?: boolean;
  revision?: number | undefined;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const view = useRef<AvatarView | undefined>(undefined);
  const [savedPhoto, setSavedPhoto] = useState('');
  useEffect(() => {
    let live = true;
    if (look.kind === 'photo' && !photo && client && profile)
      void client
        .invoke('bots.appearance.get', { profile })
        .then((data) => {
          if (
            live &&
            data &&
            typeof data === 'object' &&
            'data' in data &&
            typeof data.data === 'string' &&
            /^data:image\/(png|jpeg|webp);base64,/.test(data.data)
          )
            setSavedPhoto(data.data);
        })
        .catch(() => undefined);
    return () => {
      live = false;
      setSavedPhoto('');
    };
  }, [look.kind, photo, client, profile, revision]);
  const image = look.kind === 'photo' ? photo || savedPhoto : '';
  useEffect(() => {
    if (!host.current || look.kind !== 'shape') return;
    const scheduler = acquire();
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => scheduler.configure(true, motion.matches);
    update();
    motion.addEventListener('change', update);
    const avatar = new AvatarView(
      id,
      SHAPES.includes(look.shape) ? look.shape : 'pebble',
      COLORS.find((c) => c.id === look.color)?.hex ?? COLORS[0].hex,
      state,
      false,
      large,
    );
    view.current = avatar;
    host.current.append(avatar.svg);
    scheduler.add(avatar);
    const root =
      host.current.closest('.pebble-row,.pinned-tile') ??
      host.current.closest('.details-panel') ??
      host.current.closest('.chat-drawer') ??
      host.current.closest('.appearance-picker') ??
      host.current;
    avatar.bindPointer(root, scheduler);
    return () => {
      scheduler.remove(avatar);
      avatar.svg.remove();
      view.current = undefined;
      motion.removeEventListener('change', update);
      release();
    };
  }, [id, look.kind, look.shape, look.color, orchestrator, large]);
  useEffect(() => {
    if (view.current && clock) {
      view.current.setState(state, clock.clock);
      clock.invalidate();
    }
  }, [state]);
  return (
    <span
      className={`agent-avatar avatar-${look.kind} avatar-${look.shape} ${large ? 'large' : ''}`}
      ref={host}
    >
      {image && (
        <>
          <img src={image} alt="" draggable={false} />
          {state !== 'ready' && state !== 'done' && (
            <span className="photo-status" aria-label={state}>
              ●
            </span>
          )}
        </>
      )}
      {orchestrator && (
        <span className="avatar-star" role="img" aria-label="Main Pebble">
          <Star aria-hidden="true" />
        </span>
      )}
      {look.kind === 'photo' && !image && (
        <svg className="empty-photo" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="18" r="7" />
          <path d="M11 39v-3a13 13 0 0 1 26 0v3" />
        </svg>
      )}
    </span>
  );
}
export function AvatarChooser({
  look,
  onChange,
  photo,
  onPhoto,
  client,
  profile,
  onBusyChange,
  revision,
}: {
  look: Appearance;
  onChange: (v: Appearance) => void;
  photo: string;
  onPhoto: (v: string) => void;
  client?: BotBridgeClient;
  profile?: string;
  onBusyChange?: (busy: boolean) => void;
  revision?: number | undefined;
}) {
  const [storedPhoto, setStoredPhoto] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    setStoredPhoto('');
    if (client && profile)
      void client
        .invoke('bots.appearance.get', { profile })
        .then((value) => {
          const data = value as { data?: unknown };
          if (
            live &&
            data &&
            typeof data.data === 'string' &&
            /^data:image\/(png|jpeg|webp);base64,/.test(data.data)
          )
            setStoredPhoto(data.data);
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, profile, revision]);
  const [error, setError] = useState('');
  const [decoding, setDecoding] = useState(false);
  const missingPhoto = look.kind === 'photo' && !photo && !storedPhoto;
  useEffect(() => {
    onBusyChange?.(decoding || missingPhoto);
  }, [decoding, missingPhoto, onBusyChange]);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function choose(value: Appearance) {
    generation.current++;
    setDecoding(false);
    setError('');
    onChange(value);
  }
  return (
    <div className="appearance-picker">
      <div className="avatar-preview" role="img" aria-label="Selected avatar">
        <AgentAvatar id="appearance-preview" look={look} photo={photo || storedPhoto} large />
      </div>
      <div className="avatar-modes" role="group" aria-label="Avatar style">
        <button
          type="button"
          aria-pressed={look.kind === 'shape'}
          onClick={() => choose({ ...look, kind: 'shape' })}
        >
          Animated
        </button>
        <button
          type="button"
          aria-pressed={look.kind === 'photo'}
          onClick={() => choose({ ...look, kind: 'photo' })}
        >
          Photo
        </button>
      </div>
      {look.kind === 'photo' && (
        <div className="photo-upload">
          <button type="button" disabled={decoding} onClick={() => fileInput.current?.click()}>
            {decoding ? 'Opening photo…' : photo || storedPhoto ? 'Change photo' : 'Upload photo'}
          </button>
          <input
            ref={fileInput}
            hidden
            aria-label="Choose photo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={decoding}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const ticket = ++generation.current;
              setDecoding(true);
              setError('');
              try {
                const result = await previewPhoto(file);
                if (generation.current === ticket) {
                  onPhoto(result);
                  onChange({ ...look, kind: 'photo' });
                }
              } catch {
                if (generation.current === ticket)
                  setError('Choose a PNG, JPEG or WebP image up to 5 MB.');
              } finally {
                if (generation.current === ticket) {
                  setDecoding(false);
                }
              }
            }}
          />
        </div>
      )}
      <>
        <div className="shape-choices">
          <div className="avatar-shapes" role="group" aria-label="Avatar shape">
            {SHAPES.map((shape) => (
              <button
                key={shape}
                type="button"
                aria-label={shape}
                aria-pressed={look.shape === shape}
                onClick={() => choose({ ...look, kind: 'shape', shape })}
              >
                <svg viewBox="0 0 100 108" aria-hidden="true" focusable="false">
                  <path
                    d={BODY_PATHS[shape]}
                    fill={COLORS.find((c) => c.id === look.color)?.hex ?? COLORS[0].hex}
                  />
                  <g fill="#222329" transform="translate(3.4 -2.8)">
                    <rect x="35" y="40" width="8" height="18" rx="4" />
                    <rect x="56" y="40" width="8" height="18" rx="4" />
                  </g>
                </svg>
              </button>
            ))}
          </div>
          <div className="avatar-colors" role="group" aria-label="Avatar color">
            {COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                aria-label={color.label}
                aria-pressed={look.color === color.id}
                onClick={() => choose({ ...look, kind: 'shape', color: color.id })}
              >
                <span style={{ background: color.hex }} />
              </button>
            ))}
          </div>
        </div>
      </>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
