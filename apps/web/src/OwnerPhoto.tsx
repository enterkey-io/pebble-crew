import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CircleUserRound } from 'lucide-react';
import {
  OWNER_PHOTO_SIDE,
  base64Bytes,
  ownerPhotoValue,
} from '../../../packages/owner-service/src/photo';
import { photoCanvas } from './avatar-lab/photo';
import { ownerRequest, OwnerRequestError } from './owner-request';
import { Button } from './components/ui/button';
import { LoadingBar } from './components/ui/loading-bar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { useOverlayHistory } from './ui/overlay-history';

type PhotoState =
  | { kind: 'ready' | 'saving'; image: string | null }
  | { kind: 'error'; image: string | null; message: string };
type AccountPhoto = { state: PhotoState; edit: () => void; save: (file: File | null) => void };
const PhotoContext = createContext<AccountPhoto | undefined>(undefined);
export const useOwnerPhoto = () => useContext(PhotoContext);

export function sessionPhoto(session: unknown) {
  return session &&
    typeof session === 'object' &&
    'user' in session &&
    session.user &&
    typeof session.user === 'object' &&
    'image' in session.user
    ? ownerPhotoValue(session.user.image)
    : null;
}

export function PersonalAvatar({ large = false }: { large?: boolean }) {
  const photo = useOwnerPhoto();
  return (
    <span className={`personal-avatar${large ? ' personal-avatar-large' : ''}`} aria-hidden="true">
      {photo?.state.image ? <img src={photo.state.image} alt="" /> : <CircleUserRound />}
    </span>
  );
}

export function PersonalPhotoControls() {
  const photo = useOwnerPhoto();
  const input = useRef<HTMLInputElement>(null);
  if (!photo) return null;
  const busy = photo.state.kind === 'saving';
  return (
    <div className="personal-photo-control">
      <PersonalAvatar large />
      <div className="personal-photo-actions">
        <input
          ref={input}
          className="sr-only"
          aria-label="Your photo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) photo.save(file);
          }}
        />
        <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
          {photo.state.image ? 'Change photo' : 'Choose photo'}
        </Button>
        {photo.state.image && (
          <Button variant="ghost" disabled={busy} onClick={() => photo.save(null)}>
            Remove photo
          </Button>
        )}
        <LoadingBar active={busy} label="Saving photo" />
        {photo.state.kind === 'error' && (
          <p role="alert" className="field-error">
            {photo.state.message}
          </p>
        )}
      </div>
    </div>
  );
}

export function OwnerPhotoProvider({
  image,
  children,
  onUnauthorized,
}: {
  image: string | null;
  children: ReactNode;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<PhotoState>({ kind: 'ready', image });
  const [editing, setEditing] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  useOverlayHistory(editing, () => setEditing(false));
  async function save(file: File | null) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'saving', image: state.image });
    try {
      let pixels: string | null = null;
      if (file) {
        const canvas = await photoCanvas(file, OWNER_PHOTO_SIDE);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Photo editing is unavailable.');
        pixels = base64Bytes(context.getImageData(0, 0, OWNER_PHOTO_SIDE, OWNER_PHOTO_SIDE).data);
      }
      controller.signal.throwIfAborted();
      const result = await ownerRequest('/api/owner/photo', { pixels }, controller.signal);
      if (
        !result ||
        typeof result !== 'object' ||
        !('image' in result) ||
        (result.image !== null && ownerPhotoValue(result.image) === null)
      )
        throw new Error('Photo could not be saved.');
      if (!controller.signal.aborted)
        setState({ kind: 'ready', image: ownerPhotoValue(result.image) });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof OwnerRequestError && error.status === 401) onUnauthorized();
      else
        setState({
          kind: 'error',
          image: state.image,
          message: error instanceof Error ? error.message : 'Photo could not be saved.',
        });
    } finally {
      if (request.current === controller) request.current = undefined;
    }
  }
  return (
    <PhotoContext.Provider
      value={{ state, edit: () => setEditing(true), save: (file) => void save(file) }}
    >
      {children}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="personal-photo-dialog" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Your photo</DialogTitle>
          </DialogHeader>
          <PersonalPhotoControls />
        </DialogContent>
      </Dialog>
    </PhotoContext.Provider>
  );
}
