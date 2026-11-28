import { useEffect, useRef, useState } from 'react';
import { InterfaceSettingsDomain, WorkspaceDomain } from '@hermes-client/protocol';
import type { SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { ClientError, safeError } from '@hermes-client/core';
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
import { SidebarTitleSetting } from './SidebarTitleSetting';
import { MessageAlertsSetting } from './notifications/MessageAlertsSetting';
import type { AppearanceMode, ChatBubbleMode, InterfaceSettings } from '@hermes-client/protocol';

export function GeneralSettings({
  client,
  state,
  onChange,
  onProactive,
  interfaceSettings,
  onInterfaceSettings,
  onDirtyChange,
}: {
  client: SessionClient;
  state: WorkspaceSnapshot;
  onChange: (state: WorkspaceSnapshot) => void;
  onProactive?: (() => void) | undefined;
  interfaceSettings: InterfaceSettings;
  onInterfaceSettings: (settings: InterfaceSettings) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { mode, setMode, chatBubbles, setChatBubbles } = useAppearance();
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceIssue, setAppearanceIssue] = useState('');
  const supported = client.supportsWorkspaceSettings;
  const [saving, setSaving] = useState(false);
  const flight = useRef(false);
  const [issue, setIssue] = useState<{ target: boolean; message: string }>();
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    flight.current = false;
    setSaving(false);
    setIssue(undefined);
    setSavingAppearance(false);
    setAppearanceIssue('');
    return () => {
      generation.current++;
    };
  }, [client, state.id, supported]);
  useEffect(() => {
    if (issue && state.features?.tasks === issue.target) setIssue(undefined);
  }, [issue, state.features?.tasks]);
  async function changeAppearance(
    choice:
      | { appearance: AppearanceMode; chatBubbles?: never }
      | { appearance?: never; chatBubbles: ChatBubbleMode },
  ) {
    if (savingAppearance) return;
    if (choice.appearance && interfaceSettings.appearance === undefined) {
      setMode(choice.appearance);
      return;
    }
    if (choice.chatBubbles && interfaceSettings.chatBubbles === undefined) {
      setChatBubbles(choice.chatBubbles);
      return;
    }
    const key = choice.appearance ? 'appearance' : 'chatBubbles';
    const wanted = choice[key];
    const domain = new InterfaceSettingsDomain(client);
    const token = generation.current;
    const active = () => generation.current === token;
    setSavingAppearance(true);
    setAppearanceIssue('');
    try {
      let latest: InterfaceSettings;
      try {
        latest = await domain.update(choice, interfaceSettings.revision);
      } catch {
        latest = await domain.read();
        if (!active()) return;
        onInterfaceSettings(latest);
        // Merge a change to another setting, but don't overwrite a choice
        // made on another device while this one was out of date.
        if (latest[key] !== wanted && latest[key] === interfaceSettings[key])
          latest = await domain.update(choice, latest.revision);
      }
      if (!active()) return;
      onInterfaceSettings(latest);
      if (latest[key] !== wanted) setAppearanceIssue('Settings changed elsewhere. Try again.');
    } catch {
      if (active()) setAppearanceIssue('Couldn’t confirm this change. Try again.');
    } finally {
      if (active()) setSavingAppearance(false);
    }
  }
  async function changeTasks(enabled: boolean) {
    if (flight.current) return;
    flight.current = true;
    setSaving(true);
    setIssue(undefined);
    const token = generation.current;
    const active = () => generation.current === token;
    const accept = (latest: WorkspaceSnapshot) => {
      if (latest.id !== state.id) throw new ClientError('INVALID_RESPONSE');
      if (active()) onChange(latest);
      return latest.features?.tasks === enabled;
    };
    const domain = new WorkspaceDomain(client);
    try {
      await domain.setTasksEnabled({
        enabled,
        expectedRevision: state.revision,
        workspaceId: state.id,
      });
      if (!active()) return;
      // A receipt can be idempotent at a newer revision. Never stamp that revision
      // onto an older roster captured when the switch was clicked.
      if (!accept(await domain.describeWorkspace()) && active())
        setIssue({ target: enabled, message: 'Settings changed. Try again.' });
    } catch (cause) {
      if (!active()) return;
      // A lost response can follow a committed preference. Read before offering a retry.
      try {
        const latest = await domain.describeWorkspace();
        if (!active()) return;
        if (!accept(latest))
          setIssue({
            target: enabled,
            message:
              safeError(cause).code === 'STALE_REVISION'
                ? 'Settings changed. Try again.'
                : 'Couldn’t save Tasks. Try again.',
          });
      } catch {
        if (active())
          setIssue({ target: enabled, message: 'Couldn’t confirm this change. Try again.' });
      }
    } finally {
      if (active()) {
        flight.current = false;
        setSaving(false);
      }
    }
  }
  return (
    <section aria-label="General settings">
      <SidebarTitleSetting
        client={client}
        settings={interfaceSettings}
        onChange={onInterfaceSettings}
        onDirtyChange={onDirtyChange}
      />
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
            disabled={savingAppearance}
            onValueChange={(value) => {
              if (value === 'light' || value === 'dark' || value === 'system')
                void changeAppearance({ appearance: value });
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
      <Item className="flex-nowrap px-0">
        <ItemContent>
          <ItemTitle>
            <Label htmlFor="chat-bubble-mode">Chat bubbles</Label>
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <Select
            value={chatBubbles}
            disabled={savingAppearance}
            onValueChange={(value) => {
              if (value === 'pebble' || value === 'neutral')
                void changeAppearance({ chatBubbles: value });
            }}
          >
            <SelectTrigger id="chat-bubble-mode" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pebble">Pebble color</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
      {appearanceIssue && <Notice error>{appearanceIssue}</Notice>}
      {supported && state.features && (
        <Item className="flex-nowrap px-0">
          <ItemContent>
            <ItemTitle>
              <Label htmlFor="tasks-enabled">Tasks</Label>
            </ItemTitle>
            <ItemDescription>Project boards and plans.</ItemDescription>
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
      {issue && <Notice error>{issue.message}</Notice>}
      <MessageAlertsSetting client={client} />
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
