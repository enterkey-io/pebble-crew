import { Label } from '../components/ui/label';
import { useId } from 'react';
import type { ReactNode } from 'react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import {
  roleInstructions,
  withRoleInstructions,
  ROLE_INSTRUCTIONS_LIMIT,
} from '@hermes-client/protocol';
import type {
  Appearance,
  Role,
  WorkspaceSnapshot as WorkspaceState,
} from '@hermes-client/protocol';
import { AvatarChooser } from '../AgentAvatar';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Field, FieldLabel, FieldDescription } from '../components/ui/field';
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
        <Label layout="stacked">
          Name
          <Input
            required
            maxLength={80}
            autoComplete="off"
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Label>
        <Label layout="stacked">
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
        </Label>
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
      <Label layout="stacked">
        Title
        <Input
          maxLength={1000}
          value={title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Researcher"
        />
      </Label>
      <Label layout="stacked">
        Description
        <Textarea
          aria-label="Description"
          rows={3}
          maxLength={1000}
          value={description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Label>
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
    <Label layout="stacked" className="reporting-field">
      Reports to
      <Select
        value={manager || '__none__'}
        onValueChange={(value) => onChange(value === '__none__' ? '' : value)}
      >
        <SelectTrigger aria-label="Reports to">
          <SelectValue placeholder="Choose a pebble" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No manager</SelectItem>
          {choices.map((bot) => (
            <SelectItem key={bot.id} value={bot.profile}>
              {bot.name}
              {bot.profile === state.orchestrator ? ' · Main Pebble' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Label>
  );
}

export function RoleDetails({
  role,
  onChange,
  context = 'existing',
}: {
  role: Role;
  onChange: (patch: Partial<Role>) => void;
  context?: 'existing' | 'new';
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        Instructions <span className="font-normal text-muted-foreground">(optional)</span>
      </FieldLabel>
      <FieldDescription id={`${id}-help`}>
        {context === 'new'
          ? 'Describe their job, steps to follow and limits.'
          : 'Adds to this agent’s Hermes instructions. Their personality and memory stay in place.'}
      </FieldDescription>
      <Textarea
        id={id}
        aria-label="Instructions"
        aria-describedby={`${id}-help`}
        rows={8}
        maxLength={ROLE_INSTRUCTIONS_LIMIT}
        value={roleInstructions(role)}
        onChange={(event) => onChange(withRoleInstructions(role, event.target.value))}
      />
    </Field>
  );
}
