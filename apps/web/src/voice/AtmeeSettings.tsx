import { useEffect, useId, useState } from 'react';
import { safeError } from '@hermes-client/core';
import { AtmeeDomain } from '@hermes-client/protocol';
import type { SessionClient, WorkspaceBot, AtmeeCharacter } from '@hermes-client/protocol';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '../components/ui/item';
import { Label } from '../components/ui/label';
import { LoadingBar } from '../components/ui/loading-bar';
import { Textarea } from '../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { SecretCard } from '../components/ai-elements/secret-card';
import { FormSection } from '../ui/primitives';
import { AtmeeCharacterBuilder } from './AtmeeCharacterBuilder';

function AtmeeKeyForm({
  client,
  onSaved,
  onClose,
}: {
  client: SessionClient;
  onSaved: () => void;
  onClose: () => void;
}) {
  return (
    <SecretCard
      title="Atmee API key"
      label="API key"
      description="Use an Atmee key with avatar read access. To create video avatars, choose Every avatar and enable avatar and generation write access."
      onSkip={onClose}
      submissionError={(cause) => safeError(cause).message}
      onSubmit={async (value) => {
        await new AtmeeDomain(client).saveKey(value);
        onSaved();
      }}
    />
  );
}

export function AtmeeConnectionSettings({ client }: { client: SessionClient }) {
  const [configured, setConfigured] = useState<boolean>();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void new AtmeeDomain(client).status().then(
      (saved) => {
        if (current) setConfigured(saved);
      },
      () => {
        if (current) setError('Atmee settings are unavailable.');
      },
    );
    return () => {
      current = false;
    };
  }, [client]);
  return (
    <section aria-label="Atmee">
      <Item className="flex-nowrap px-0">
        <ItemContent>
          <ItemTitle>Atmee</ItemTitle>
          <ItemDescription>{configured ? 'API key saved' : 'Video calls'}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            variant="secondary"
            disabled={editing || configured === undefined}
            onClick={() => {
              setError('');
              setEditing(true);
            }}
          >
            {configured ? 'Replace key' : 'Add API key'}
          </Button>
        </ItemActions>
      </Item>
      {error && (
        <Alert>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {editing && (
        <AtmeeKeyForm
          client={client}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setConfigured(true);
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}

export function AtmeeCharacterSettings({
  client,
  bot,
}: {
  client: SessionClient;
  bot: WorkspaceBot;
}) {
  const botId = bot.id;
  const id = useId();
  const [characters, setCharacters] = useState<Awaited<ReturnType<AtmeeDomain['characters']>>>();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editingKey, setEditingKey] = useState(false);
  const [keyRejected, setKeyRejected] = useState(false);
  useEffect(() => {
    let current = true;
    setError('');
    setKeyRejected(false);
    void new AtmeeDomain(client).characters(botId).then(
      (value) => {
        if (current) {
          setCharacters(value);
          setNote(value.note);
        }
      },
      (cause) => {
        if (current) {
          const failure = safeError(cause);
          setError(failure.message);
          setKeyRejected(['ATMEE_KEY_REJECTED', 'ATMEE_KEY_SCOPE'].includes(failure.code));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [client, botId, revision]);
  async function selectCharacter(avatar: AtmeeCharacter) {
    setSaving(true);
    setError('');
    try {
      const saved = await new AtmeeDomain(client).select(botId, avatar.id);
      setCharacters(
        (current) =>
          current && {
            ...current,
            selected: avatar.id,
            note: saved,
            avatars: current.avatars.some((item) => item.id === avatar.id)
              ? current.avatars.map((item) => (item.id === avatar.id ? avatar : item))
              : [...current.avatars, avatar],
          },
      );
      setNote(saved);
      return true;
    } catch (cause) {
      setError(safeError(cause).message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  return (
    <FormSection title="Video" description="Your video avatar supplies the face and voice.">
      {!characters && !error && <LoadingBar active label="Loading video avatars" />}
      {editingKey ? (
        <AtmeeKeyForm
          client={client}
          onClose={() => setEditingKey(false)}
          onSaved={() => {
            setEditingKey(false);
            setCharacters(undefined);
            setRevision((value) => value + 1);
          }}
        />
      ) : characters?.configured === false || keyRejected ? (
        <Button
          type="button"
          variant="secondary"
          className="justify-self-start"
          onClick={() => setEditingKey(true)}
        >
          {keyRejected ? 'Replace Atmee API key' : 'Add Atmee API key'}
        </Button>
      ) : characters?.configured && !characters.canCreate ? (
        <div className="grid justify-items-start gap-2">
          <p className="text-sm text-muted-foreground">
            This key can select video avatars. To create one, use an Atmee key with access to every
            avatar and avatar and generation write permissions.
          </p>
          <Button type="button" variant="quiet" onClick={() => setEditingKey(true)}>
            Replace Atmee API key
          </Button>
        </div>
      ) : null}
      {characters?.configured && characters.avatars.length > 0 && (
        <div className="grid max-w-sm gap-2">
          <Label htmlFor={id}>Video avatar</Label>
          <Select
            value={
              characters.avatars.some((avatar) => avatar.id === characters.selected)
                ? (characters.selected ?? '')
                : ''
            }
            disabled={saving}
            onValueChange={(value) => {
              const avatar = characters.avatars.find((item) => item.id === value);
              if (avatar) void selectCharacter(avatar);
            }}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="Select a video avatar" />
            </SelectTrigger>
            <SelectContent position="popper">
              {characters.avatars.map((avatar) => (
                <SelectItem key={avatar.id} value={avatar.id} disabled={!avatar.ready}>
                  {avatar.name}
                  {avatar.ready ? '' : ' · Not ready'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {characters.avatars.some(
            (avatar) => avatar.id === characters.selected && avatar.ready,
          ) && (
            <div className="mt-2 grid gap-2">
              <Label htmlFor={id + '-note'}>Call notes</Label>
              <Textarea
                id={id + '-note'}
                aria-describedby={id + '-note-description'}
                rows={3}
                maxLength={1000}
                disabled={saving}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <p id={id + '-note-description'} className="text-sm text-muted-foreground">
                Atmee receives these notes and brief excerpts from the last video call.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="justify-self-start"
                disabled={saving || !characters.selected || note.trim() === characters.note}
                onClick={async () => {
                  if (!characters.selected) return;
                  setSaving(true);
                  setError('');
                  try {
                    const saved = await new AtmeeDomain(client).saveNote(
                      botId,
                      characters.selected,
                      note,
                    );
                    setCharacters((current) => current && { ...current, note: saved });
                    setNote(saved);
                  } catch (cause) {
                    setError(safeError(cause).message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Save call notes
              </Button>
            </div>
          )}
        </div>
      )}
      {characters?.configured && characters.canCreate && (
        <AtmeeCharacterBuilder
          client={client}
          bot={bot}
          selected={characters.selected}
          saving={saving}
          onSelect={selectCharacter}
        />
      )}
      {error && (
        <Alert>
          <AlertDescription>
            {error}
            <Button variant="link" onClick={() => setRevision((value) => value + 1)}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </FormSection>
  );
}
