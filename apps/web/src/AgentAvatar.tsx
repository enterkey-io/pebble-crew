import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { UnreadDot } from './ui/UnreadDot';
import { Button } from './components/ui/button';
import { Toggle } from './components/ui/toggle';
import { AvatarView, AvatarScheduler } from './avatar-lab/renderer';
import { BODY_PATHS, COLORS, SHAPES } from './avatar-lab/engine';
import { previewPhoto } from './avatar-lab/photo';
import type { Activity } from './avatar-lab/engine';
import type { Appearance } from '@hermes-client/protocol';
import type { SessionClient } from '@hermes-client/protocol';
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
type AvatarPhoto = { request: Promise<string | undefined>; data?: string };
const photoCache = new WeakMap<SessionClient, Map<string, AvatarPhoto>>();
const maxCachedPhotos = 64;

type PhotoRequest = {
  profile: string;
  id: string;
  resolve: (photo: unknown) => void;
  reject: (reason: unknown) => void;
};
const photoBatches = new WeakMap<SessionClient, PhotoRequest[]>();

function loadAvatarPhoto(client: SessionClient, profile: string, id: string) {
  if (!client.supportsAvatarThumbnails || id === profile)
    return client
      .invoke('bots.appearance.get', { profile })
      .then((value) =>
        value && typeof value === 'object' && 'data' in value ? value.data : undefined,
      );
  return new Promise<unknown>((resolve, reject) => {
    const queued = photoBatches.get(client);
    if (queued) {
      queued.push({ profile, id, resolve, reject });
      return;
    }
    const requests = [{ profile, id, resolve, reject }];
    photoBatches.set(client, requests);
    queueMicrotask(() => {
      photoBatches.delete(client);
      for (let offset = 0; offset < requests.length; offset += 8) {
        const batch = requests.slice(offset, offset + 8);
        void client
          .invoke('bots.appearance.thumbnails', {
            targets: batch.map(({ profile, id }) => ({ profile, id })),
          })
          .then((value) => {
            const photos =
              value && typeof value === 'object' && 'photos' in value ? value.photos : undefined;
            for (const item of batch)
              item.resolve(
                photos && typeof photos === 'object' && Object.hasOwn(photos, item.profile)
                  ? Reflect.get(photos, item.profile)
                  : undefined,
              );
          })
          .catch((reason) => {
            for (const item of batch) item.reject(reason);
          });
      }
    });
  });
}

function requestAvatarPhoto(client: SessionClient, profile: string, identity: string, key: string) {
  let cache = photoCache.get(client);
  if (!cache) {
    cache = new Map();
    photoCache.set(client, cache);
  }
  const previous = cache.get(key);
  if (previous) {
    cache.delete(key);
    cache.set(key, previous);
    return previous.request;
  }

  const entry: AvatarPhoto = {
    request: loadAvatarPhoto(client, profile, identity)
      .then((data) => {
        if (typeof data === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data)) {
          entry.data = data;
          return data;
        }
        if (cache.get(key) === entry) cache.delete(key);
        return '';
      })
      .catch(() => {
        if (cache.get(key) === entry) cache.delete(key);
        return undefined;
      }),
  };
  cache.set(key, entry);
  const oldest = cache.keys().next();
  if (cache.size > maxCachedPhotos && !oldest.done) cache.delete(oldest.value);
  return entry.request;
}

function useSavedAvatarPhoto(
  client: SessionClient | undefined,
  profile: string | undefined,
  revision: number | undefined,
  identity = profile,
) {
  const [loaded, setLoaded] = useState<{ client: SessionClient; identity: string; data: string }>();
  const key = JSON.stringify([profile, identity, revision]);
  useEffect(() => {
    if (!client || !profile || !identity) return;
    let current = true;
    void requestAvatarPhoto(client, profile, identity, key).then((data) => {
      if (current && data !== undefined) setLoaded({ client, identity, data });
    });
    return () => {
      current = false;
    };
  }, [client, profile, key, identity]);

  const cached = client && photoCache.get(client)?.get(key)?.data;
  const current = loaded && loaded.client === client && loaded.identity === identity;
  return cached ?? (current ? loaded.data : '');
}

export function AgentAvatar({
  id,
  look,
  state = 'ready',
  orchestrator = false,
  unread = false,
  photo,
  client,
  profile,
  large = false,
  revision,
  animated = true,
}: {
  id: string;
  look: Appearance;
  state?: Activity;
  orchestrator?: boolean;
  unread?: boolean;
  photo?: string;
  client?: SessionClient;
  profile?: string;
  large?: boolean;
  revision?: number | undefined;
  animated?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const view = useRef<AvatarView | undefined>(undefined);
  const savedPhoto = useSavedAvatarPhoto(
    look.kind === 'photo' && !photo ? client : undefined,
    profile,
    revision,
    id,
  );
  const image = look.kind === 'photo' ? photo || savedPhoto : '';
  useLayoutEffect(() => {
    if (!host.current || look.kind !== 'shape') return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
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
    if (!animated) {
      avatar.render(0, true);
      return () => {
        avatar.svg.remove();
        view.current = undefined;
      };
    }
    const scheduler = acquire();
    const update = () => scheduler.configure(true, motion.matches);
    update();
    motion.addEventListener('change', update);
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
  }, [id, look.kind, look.shape, look.color, orchestrator, large, animated]);
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
            <span className="photo-status" role="img" aria-label={state} />
          )}
        </>
      )}
      {unread ? (
        <UnreadDot avatar />
      ) : (
        orchestrator && (
          <span className="avatar-star" role="img" aria-label="Main Pebble">
            <Star className="size-[9px]" aria-hidden="true" />
          </span>
        )
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
  client?: SessionClient;
  profile?: string;
  onBusyChange?: (busy: boolean) => void;
  revision?: number | undefined;
}) {
  const storedPhoto = useSavedAvatarPhoto(client, profile, revision);
  const fileInput = useRef<HTMLInputElement>(null);
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
      <div className="flex gap-1" role="group" aria-label="Avatar style">
        <Toggle
          type="button"
          pressed={look.kind === 'shape'}
          onPressedChange={() => choose({ ...look, kind: 'shape' })}
        >
          Animated
        </Toggle>
        <Toggle
          type="button"
          pressed={look.kind === 'photo'}
          onPressedChange={() => choose({ ...look, kind: 'photo' })}
        >
          Photo
        </Toggle>
      </div>
      {look.kind === 'photo' && (
        <div className="photo-upload">
          <Button
            type="button"
            variant="secondary"
            disabled={decoding}
            onClick={() => fileInput.current?.click()}
          >
            {decoding ? 'Opening photo…' : photo || storedPhoto ? 'Change photo' : 'Upload photo'}
          </Button>
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
          <div className="grid grid-cols-5 gap-2" role="group" aria-label="Avatar shape">
            {SHAPES.map((shape) => (
              <Toggle
                className="h-12 w-11 p-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                key={shape}
                type="button"
                aria-label={shape}
                pressed={look.shape === shape}
                onPressedChange={() => choose({ ...look, kind: 'shape', shape })}
              >
                <svg className="size-9" viewBox="0 0 100 108" aria-hidden="true" focusable="false">
                  <path
                    d={BODY_PATHS[shape]}
                    fill={COLORS.find((c) => c.id === look.color)?.hex ?? COLORS[0].hex}
                  />
                  <g fill="#222329" transform="translate(3.4 -2.8)">
                    <rect x="35" y="40" width="8" height="18" rx="4" />
                    <rect x="56" y="40" width="8" height="18" rx="4" />
                  </g>
                </svg>
              </Toggle>
            ))}
          </div>
          <div className="grid grid-cols-6 gap-1" role="group" aria-label="Avatar color">
            {COLORS.map((color) => (
              <Toggle
                className="size-9 min-w-0 rounded-full p-0 pointer-coarse:size-11"
                key={color.id}
                type="button"
                aria-label={color.label}
                pressed={look.color === color.id}
                onPressedChange={() => choose({ ...look, kind: 'shape', color: color.id })}
              >
                <span className="size-[22px] rounded-full" style={{ background: color.hex }} />
              </Toggle>
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
