import { useEffect, useId, useRef, useState } from 'react';
import { safeError } from '@hermes-client/core';
import { AtmeeDomain } from '@hermes-client/protocol';
import { ImagePlus } from 'lucide-react';
import type {
  AtmeeBuild,
  AtmeeCharacter,
  AtmeeVoiceChoice,
  SessionClient,
  WorkspaceBot,
} from '@hermes-client/protocol';
import { photoCanvas } from '../avatar-lab/photo';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { LoadingBar } from '../components/ui/loading-bar';
import { Textarea } from '../components/ui/textarea';
import { Disclosure } from '../components/ui/disclosure';
import { AtmeeVoicePicker } from './AtmeeVoicePicker';

function pending(build: AtmeeBuild | null) {
  return build?.state === 'preparing' || build?.state === 'building';
}

export function AtmeeCharacterBuilder({
  client,
  bot,
  selected,
  saving,
  onSelect,
  voices,
  canDesign,
}: {
  client: SessionClient;
  bot: WorkspaceBot;
  selected: string | null;
  saving: boolean;
  onSelect: (avatar: AtmeeCharacter) => Promise<boolean>;
  voices: AtmeeCharacter[];
  canDesign: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [profile, setProfile] = useState<'loading' | 'soul' | 'role'>('loading');
  const [reviewed, setReviewed] = useState(false);
  const [voice, setVoice] = useState<AtmeeVoiceChoice | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState('');
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [build, setBuild] = useState<AtmeeBuild | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const request = useRef<string | undefined>(undefined);
  const photoRead = useRef(0);
  const botId = bot.id;

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const value = await new AtmeeDomain(client).buildStatus(botId);
        if (!current) return;
        setLoaded(true);
        setBuild(value);
        if (pending(value)) timer = setTimeout(() => void check(), 3500);
      } catch (cause) {
        if (current) setError(safeError(cause).message);
      }
    };
    void check();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, botId, refresh]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void new AtmeeDomain(client).buildProfile(botId).then(
      (data) => {
        if (!current) return;
        setName(data.name);
        setPersona(data.persona);
        setProfile(data.hasSoul ? 'soul' : 'role');
      },
      (cause) => {
        if (current) setError(safeError(cause).message);
      },
    );
    return () => {
      current = false;
    };
  }, [open, client, botId]);

  async function choosePhoto(file: File | undefined) {
    const readingId = ++photoRead.current;
    setPhoto('');
    setError('');
    setReading(Boolean(file));
    if (!file) return;
    try {
      const canvas = await photoCanvas(file, 896, false);
      if (readingId === photoRead.current) setPhoto(canvas.toDataURL('image/jpeg', 0.88));
    } catch (cause) {
      if (readingId === photoRead.current) setError(safeError(cause).message);
    } finally {
      if (readingId === photoRead.current) setReading(false);
    }
  }

  const requirement =
    profile === 'loading'
      ? error
        ? 'Resolve the Atmee setup error above.'
        : 'Checking Atmee setup…'
      : !photo
        ? 'Choose a portrait.'
        : !voice
          ? 'Choose a voice sample or upload a recording.'
          : !reviewed
            ? 'Open Review Hermes profile before creating.'
            : !name.trim() || !persona.trim()
              ? 'Add an avatar name and instructions.'
              : '';

  async function create() {
    if (submitting || reading || requirement || !voice) return;
    setSubmitting(true);
    setError('');
    request.current ??= crypto.randomUUID();
    try {
      const next = await new AtmeeDomain(client).createCharacter(botId, request.current, {
        name,
        persona,
        voice,
        photo,
      });
      setBuild(next);
      setOpen(false);
      setPhoto('');
      request.current = undefined;
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(safeError(cause).message);
    } finally {
      setSubmitting(false);
    }
  }

  const working = pending(build);
  return (
    <div className="grid max-w-md gap-3">
      {working && (
        <div className="grid gap-2">
          <LoadingBar active label="Creating video avatar" />
          <p role="status" className="text-sm text-muted-foreground">
            Creating {build?.name}… You can close this and come back.
          </p>
        </div>
      )}
      {build?.state === 'ready' && build.avatar !== selected && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">{build.name} is ready.</span>
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              if (build.avatar) void onSelect({ id: build.avatar, name: build.name, ready: true });
            }}
          >
            Use video avatar
          </Button>
        </div>
      )}
      {(build?.error || error) && (
        <Alert>
          <AlertDescription>{error || build?.error}</AlertDescription>
          {error && !open && (
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setError('');
                setRefresh((value) => value + 1);
              }}
            >
              Check again
            </Button>
          )}
        </Alert>
      )}
      {loaded && !open && !working && (
        <Button
          type="button"
          variant="secondary"
          className="justify-self-start"
          onClick={() => {
            setError('');
            setProfile('loading');
            setReviewed(false);
            setVoice(null);
            setPhoto('');
            setOpen(true);
          }}
        >
          New video avatar
        </Button>
      )}
      {open && (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <fieldset disabled={submitting} className="grid gap-5">
            <legend className="mb-3 text-sm font-medium">New video avatar</legend>
            <div className="flex items-center gap-4">
              <div className="grid aspect-[4/5] w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                {photo ? (
                  <img src={photo} alt="Portrait preview" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus aria-hidden="true" className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="grid justify-items-start gap-1">
                <span className="text-sm font-medium">Portrait</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => photoInput.current?.click()}
                >
                  {photo ? 'Replace photo' : 'Choose photo'}
                </Button>
              </div>
              <input
                ref={photoInput}
                aria-label="Portrait"
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void choosePhoto(event.target.files?.[0])}
              />
            </div>
            <AtmeeVoicePicker
              client={client}
              botId={botId}
              name={name}
              voices={voices}
              canDesign={canDesign}
              value={voice}
              onChange={setVoice}
            />
            {profile === 'loading' && !error ? (
              <LoadingBar active label="Reading Hermes profile" />
            ) : (
              profile !== 'loading' && (
                <Disclosure
                  title="Review Hermes profile"
                  description={
                    profile === 'soul'
                      ? 'Prepared from this Pebble’s SOUL and role.'
                      : 'Prepared from this Pebble’s profile.'
                  }
                  onOpenChange={(open) => {
                    if (open) setReviewed(true);
                  }}
                >
                  <div className="grid gap-2">
                    <Label htmlFor={id + '-name'}>Avatar name</Label>
                    <Input
                      id={id + '-name'}
                      value={name}
                      maxLength={100}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={id + '-persona'}>Avatar instructions</Label>
                    <Textarea
                      id={id + '-persona'}
                      rows={5}
                      value={persona}
                      maxLength={3000}
                      onChange={(event) => setPersona(event.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Atmee receives these instructions when you create the avatar.
                    </p>
                  </div>
                </Disclosure>
              )
            )}
          </fieldset>
          {requirement && (
            <p id={id + '-requirement'} role="status" className="text-sm text-muted-foreground">
              {requirement}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || reading || Boolean(requirement)}
              aria-describedby={requirement ? id + '-requirement' : undefined}
            >
              {submitting ? 'Starting…' : 'Create video avatar'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
