import { useEffect, useId, useRef, useState } from 'react';
import { safeError } from '@hermes-client/core';
import { ATMEE_VOICE_STYLES, AtmeeDomain } from '@hermes-client/protocol';
import type {
  AtmeeBuild,
  AtmeeCharacter,
  AtmeeVoiceStyle,
  SessionClient,
  WorkspaceBot,
} from '@hermes-client/protocol';
import { photoCanvas } from '../avatar-lab/photo';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { LoadingBar } from '../components/ui/loading-bar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';

const styleLabels: Record<AtmeeVoiceStyle, string> = {
  warm: 'Warm & conversational',
  composed: 'Calm & clear',
  bright: 'Bright & upbeat',
  soft: 'Soft & reassuring',
};

function pending(build: AtmeeBuild | null) {
  return build?.state === 'preparing' || build?.state === 'building';
}

export function AtmeeCharacterBuilder({
  client,
  bot,
  selected,
  saving,
  onSelect,
}: {
  client: SessionClient;
  bot: WorkspaceBot;
  selected: string | null;
  saving: boolean;
  onSelect: (avatar: AtmeeCharacter) => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(bot.name.slice(0, 100));
  const [persona, setPersona] = useState(() => {
    const role = bot.role.title.trim();
    const details = [...new Set([bot.role.description, bot.description].map((item) => item.trim()))]
      .filter(Boolean)
      .join('\n\n');
    return [role ? `${bot.name} is a ${role}.` : `You are ${bot.name}.`, details]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 3000);
  });
  const [style, setStyle] = useState<AtmeeVoiceStyle>('warm');
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

  async function create() {
    if (submitting || !photo || !name.trim() || !persona.trim()) return;
    setSubmitting(true);
    setError('');
    request.current ??= crypto.randomUUID();
    try {
      const next = await new AtmeeDomain(client).createCharacter(botId, request.current, {
        name,
        persona,
        style,
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
          <fieldset disabled={submitting} className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">New video avatar</legend>
            <div className="flex items-end gap-3">
              <div className="grid min-w-0 flex-1 gap-2">
                <Label htmlFor={id + '-photo'}>Portrait</Label>
                <Input
                  id={id + '-photo'}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => void choosePhoto(event.target.files?.[0])}
                />
              </div>
              {photo && (
                <img
                  src={photo}
                  alt="Portrait preview"
                  className="max-h-14 w-10 shrink-0 rounded-md object-contain"
                />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={id + '-style'}>Voice style</Label>
              <Select
                value={style}
                disabled={submitting}
                onValueChange={(value) => {
                  const next = ATMEE_VOICE_STYLES.find((item) => item === value);
                  if (next) setStyle(next);
                }}
              >
                <SelectTrigger id={id + '-style'} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {ATMEE_VOICE_STYLES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {styleLabels[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              <Label htmlFor={id + '-persona'}>Avatar description</Label>
              <Textarea
                id={id + '-persona'}
                rows={4}
                value={persona}
                maxLength={3000}
                onChange={(event) => setPersona(event.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Atmee receives these fields. Voice generation may use credits.
              </p>
            </div>
          </fieldset>
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
              disabled={submitting || reading || !photo || !name.trim() || !persona.trim()}
            >
              {submitting ? 'Starting…' : 'Create video avatar'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
