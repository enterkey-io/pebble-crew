import { useEffect, useId, useState } from 'react';
import { safeError } from '@hermes-client/core';
import { AtmeeDomain } from '@hermes-client/protocol';
import type { SessionClient } from '@hermes-client/protocol';
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
        <SecretCard
          title="Atmee API key"
          label="API key"
          description="Saved privately in Hermes. Use a key with access to sessions and characters."
          onSkip={() => {
            setEditing(false);
            setError('');
          }}
          onSubmit={async (value) => {
            try {
              setError('');
              await new AtmeeDomain(client).saveKey(value);
              setConfigured(true);
              setEditing(false);
            } catch (cause) {
              setError(safeError(cause).message);
            }
          }}
        />
      )}
    </section>
  );
}

export function AtmeeCharacterSettings({
  client,
  botId,
}: {
  client: SessionClient;
  botId: string;
}) {
  const id = useId();
  const [characters, setCharacters] = useState<Awaited<ReturnType<AtmeeDomain['characters']>>>();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setError('');
    void new AtmeeDomain(client).characters(botId).then(
      (value) => {
        if (current) {
          setCharacters(value);
          setNote(value.note);
        }
      },
      (cause) => {
        if (current) setError(safeError(cause).message);
      },
    );
    return () => {
      current = false;
    };
  }, [client, botId, revision]);
  return (
    <FormSection title="Video" description="Your Atmee character supplies the face and voice.">
      {!characters && !error && <LoadingBar active label="Loading Atmee characters" />}
      {characters?.configured === false && (
        <p className="text-sm text-muted-foreground">
          Add an Atmee API key in Settings → Connections.
        </p>
      )}
      {characters?.configured && !characters.avatars.length && (
        <p className="text-sm text-muted-foreground">
          Create a conversational character in Atmee Studio.
        </p>
      )}
      {characters?.configured && characters.avatars.length > 0 && (
        <div className="grid max-w-sm gap-2">
          <Label htmlFor={id}>Character</Label>
          <Select
            value={
              characters.avatars.some((avatar) => avatar.id === characters.selected)
                ? (characters.selected ?? '')
                : ''
            }
            disabled={saving}
            onValueChange={async (value) => {
              setSaving(true);
              setError('');
              try {
                const saved = await new AtmeeDomain(client).select(botId, value);
                setCharacters((current) => current && { ...current, selected: value, note: saved });
                setNote(saved);
              } catch (cause) {
                setError(safeError(cause).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="Select a character" />
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
