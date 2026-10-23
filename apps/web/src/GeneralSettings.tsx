import { useRef, useState } from 'react';
import { WorkspaceDomain } from '@hermes-client/protocol';
import type { SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { safeError } from '@hermes-client/core';
import { Switch } from './components/ui/switch';
import { Notice } from './ui/primitives';
import { Button } from './components/ui/button';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Label } from './components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from './components/ui/item';
import { useAppearance } from './ui/AppearanceProvider';

export function GeneralSettings({
  client,
  state,
  onChange,
  onProactive,
}: {
  client: SessionClient;
  state: WorkspaceSnapshot;
  onChange: (state: WorkspaceSnapshot) => void;
  onProactive?: (() => void) | undefined;
}) {
  const { mode, setMode } = useAppearance();
  const [saving, setSaving] = useState(false);
  const flight = useRef(false);
  const [error, setError] = useState('');
  async function changeTasks(enabled: boolean) {
    if (flight.current) return;
    flight.current = true;
    setSaving(true);
    setError('');
    const domain = new WorkspaceDomain(client);
    try {
      const result = await domain.setTasksEnabled(enabled, state.revision);
      onChange({ ...state, ...result });
    } catch (cause) {
      // A lost response can follow a committed preference. Read before offering a retry.
      try {
        const latest = await domain.describeWorkspace();
        onChange(latest);
        if (latest.features?.tasks !== enabled)
          setError(
            safeError(cause).code === 'STALE_REVISION'
              ? 'Settings changed. Try again.'
              : 'Couldn’t save Tasks. Try again.',
          );
      } catch {
        setError('Couldn’t confirm this change. Reconnect before trying again.');
      }
    } finally {
      flight.current = false;
      setSaving(false);
    }
  }
  return (
    <section aria-label="General settings">
      <Item className="flex-nowrap px-0">
        <ItemContent>
          <ItemTitle>
            <Label htmlFor="appearance-mode">Appearance</Label>
          </ItemTitle>
          <ItemDescription>System follows your device’s light or dark mode.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select
            value={mode}
            onValueChange={(value) => {
              if (value === 'light' || value === 'dark' || value === 'system') setMode(value);
            }}
          >
            <SelectTrigger id="appearance-mode" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">
                <Monitor />
                System
              </SelectItem>
              <SelectItem value="light">
                <Sun />
                Light
              </SelectItem>
              <SelectItem value="dark">
                <Moon />
                Dark
              </SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
      {state.features && (
        <Item className="flex-nowrap px-0">
          <ItemContent>
            <ItemTitle>
              <Label htmlFor="tasks-enabled">Tasks</Label>
            </ItemTitle>
            <ItemDescription>Show boards and goals. Kanban still works when off.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              id="tasks-enabled"
              checked={state.features.tasks}
              disabled={saving}
              aria-busy={saving}
              onCheckedChange={(enabled) => void changeTasks(enabled)}
            />
          </ItemActions>
        </Item>
      )}
      {error && <Notice error>{error}</Notice>}
      {onProactive && (
        <Item className="flex-nowrap px-0">
          <ItemContent>
            <ItemTitle>Proactive help</ItemTitle>
            <ItemDescription>Choose routines for your Main Pebble.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="secondary" onClick={onProactive}>
              Set up
            </Button>
          </ItemActions>
        </Item>
      )}
    </section>
  );
}
