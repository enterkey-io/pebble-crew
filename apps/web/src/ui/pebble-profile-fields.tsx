import type { ReactNode } from 'react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import type {
  Appearance,
  Role,
  WorkspaceSnapshot as WorkspaceState,
} from '@hermes-client/protocol';
import { AvatarChooser } from '../AgentAvatar';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

export type ProfileDraft = { name: string; handle: string; appearance: Appearance; photo: string };
export function PebbleProfileFields({
  value,
  onChange,
  client,
  profile,
  onAvatarBusy,
  revision,
  children,
}: {
  value: ProfileDraft;
  onChange: (patch: Partial<ProfileDraft>) => void;
  client?: BotBridgeClient;
  profile?: string;
  onAvatarBusy: (busy: boolean) => void;
  revision?: number;
  children?: ReactNode;
}) {
  return (
    <div className="pebble-profile-fields">
      <div className="profile-identity-fields">
        <label>
          Name
          <Input
            required
            maxLength={80}
            autoComplete="off"
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <label>
          Handle
          <span className="handle-input">
            <span aria-hidden="true">@</span>
            <Input
              required
              aria-label="Handle"
              minLength={2}
              maxLength={32}
              pattern="[a-z][a-z0-9_-]{1,31}"
              autoCapitalize="none"
              autoComplete="off"
              value={value.handle}
              onChange={(e) => onChange({ handle: e.target.value })}
            />
          </span>
        </label>
        {children}
      </div>
      <AvatarChooser
        look={value.appearance}
        photo={value.photo}
        onChange={(appearance) => onChange({ appearance })}
        onPhoto={(photo) => onChange({ photo })}
        onBusyChange={onAvatarBusy}
        revision={revision}
        {...(client ? { client } : {})}
        {...(profile ? { profile } : {})}
      />
    </div>
  );
}
export function RoleBasics({
  title,
  description,
  onChange,
}: {
  title: string;
  description: string;
  onChange: (patch: { title?: string; description?: string }) => void;
}) {
  return (
    <>
      <label>
        Title
        <Input
          maxLength={1000}
          value={title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Researcher"
        />
      </label>
      <label>
        Description
        <Textarea
          aria-label="Description"
          rows={3}
          maxLength={1000}
          value={description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>
    </>
  );
}

export function ReportingField({
  state,
  profile,
  manager,
  onChange,
}: {
  state: WorkspaceState;
  profile?: string;
  manager: string;
  onChange: (manager: string) => void;
}) {
  if (profile === state.orchestrator) return null;
  const choices = state.bots.filter((bot) => {
    if (!bot.enrolled || bot.available === false) return false;
    const visited = new Set<string>();
    let current: typeof bot | undefined = bot;
    while (current && !visited.has(current.profile)) {
      if (current.profile === profile) return false;
      visited.add(current.profile);
      current = state.bots.find((b) => b.profile === current?.manager);
    }
    return true;
  });
  return (
    <label className="reporting-field">
      Reports to
      <Select value={manager || state.orchestrator || ''} onValueChange={onChange}>
        <SelectTrigger aria-label="Reports to">
          <SelectValue placeholder="Choose a pebble" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((bot) => (
            <SelectItem key={bot.id} value={bot.profile}>
              {bot.name}
              {bot.profile === state.orchestrator ? ' · Main Pebble' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function RoleDetails({
  role,
  onChange,
}: {
  role: Role;
  onChange: (patch: Partial<Role>) => void;
}) {
  return (
    <details className="form-disclosure">
      <summary>Responsibilities & boundaries</summary>
      {(['responsibilities', 'boundaries', 'expectedOutputs'] as const).map((key) => {
        const label = {
          responsibilities: 'Responsibilities',
          boundaries: 'Boundaries',
          expectedOutputs: 'Expected outputs',
        }[key];
        return (
          <label key={key}>
            {label}
            <Textarea
              aria-label={label}
              rows={3}
              maxLength={1000}
              value={role[key]}
              onChange={(event) => onChange({ [key]: event.target.value })}
            />
          </label>
        );
      })}
    </details>
  );
}
