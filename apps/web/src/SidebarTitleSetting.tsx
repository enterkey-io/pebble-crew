import { useEffect, useRef, useState } from 'react';
import { InterfaceSettingsDomain } from '@hermes-client/protocol';
import type { InterfaceSettings, SessionClient } from '@hermes-client/protocol';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Item, ItemContent, ItemTitle } from './components/ui/item';
import { Notice } from './ui/primitives';

export function SidebarTitleSetting({
  client,
  settings,
  onChange,
  onDirtyChange,
}: {
  client: SessionClient;
  settings: InterfaceSettings;
  onChange: (value: InterfaceSettings) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [baseline, setBaseline] = useState(settings);
  const [draft, setDraft] = useState(settings.appTitle);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [client]);
  const dirty = draft !== baseline.appTitle;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (settings.revision <= baseline.revision) return;
    if (draft === baseline.appTitle) setDraft(settings.appTitle);
    else if (settings.appTitle !== baseline.appTitle && draft !== settings.appTitle)
      setIssue('App title changed elsewhere. Review your title before saving.');
    setBaseline(settings);
  }, [settings, baseline, draft]);
  async function save() {
    if (saving) return;
    setSaving(true);
    setIssue('');
    const title = draft.trim();
    const token = generation.current;
    const active = () => generation.current === token;
    const domain = new InterfaceSettingsDomain(client);
    try {
      const value = await domain.update({ appTitle: title }, baseline.revision);
      if (!active()) return;
      setBaseline(value);
      setDraft(value.appTitle);
      onChange(value);
    } catch {
      if (!active()) return;
      // A lost receipt may follow a committed write. Read it before offering another save.
      try {
        const value = await domain.read();
        if (!active()) return;
        setBaseline(value);
        onChange(value);
        if (value.appTitle === title) setDraft(title);
        else setIssue('Couldn’t save this title. Review it and try again.');
      } catch {
        if (active()) setIssue('Couldn’t confirm the title. Try again when Hermes is available.');
      }
    } finally {
      if (active()) setSaving(false);
    }
  }
  return (
    <Item className="px-0">
      <ItemContent>
        <ItemTitle>
          <Label htmlFor="app-title">App title</Label>
        </ItemTitle>
        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            id="app-title"
            value={draft}
            maxLength={64}
            required
            disabled={saving}
            className="min-w-0 flex-1"
            onChange={(event) => {
              setDraft(event.target.value);
              setIssue('');
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={!dirty || !draft.trim() || saving}
            aria-busy={saving}
          >
            Save
          </Button>
        </form>
        {issue && <Notice error>{issue}</Notice>}
      </ItemContent>
    </Item>
  );
}
