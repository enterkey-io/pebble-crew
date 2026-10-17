import { ClientError, safeError } from '@hermes-client/core';
import type { ErrorCode } from '@hermes-client/core';
import type { BotBridgeClient } from './bridge';
import { record } from './json';
import { decodeAgentCapabilities, decodeRole, decodeWorkspaceSnapshot } from './workspace';
import type { Appearance, Role, WorkspaceBot, WorkspaceSnapshot } from './workspace';

export type PhotoEdit = { kind: 'preserve' } | { kind: 'replace'; data: string };
export type ProfileEdit = {
  target: Pick<WorkspaceBot, 'profile' | 'id'>;
  expectedRevision: number;
  name: string;
  handle: string;
  appearance: Appearance;
  photo: PhotoEdit;
  role: Role;
  manager: string | null;
};
export type RoleAssignmentEdit = {
  profile: string;
  expectedRevision: number;
  role: Role;
  manager: string | null;
  team: string | null;
};
export type WriteOutcome<T> =
  | { kind: 'confirmed'; value: T }
  | { kind: 'refused'; reason: ErrorCode }
  | { kind: 'uncertain'; evidence: { code: ErrorCode } };

type ProfileReceipt = { state: 'completed'; profile: string };
function profileReceipt(value: unknown, profile: string): ProfileReceipt {
  const data = record(value);
  if (data.state !== 'completed' || data.profile !== profile)
    throw new ClientError('INVALID_RESPONSE');
  return { state: 'completed', profile };
}
function roleReceipt(value: unknown, profile: string) {
  const data = record(value);
  if (
    typeof data.revision !== 'number' ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0
  )
    throw new ClientError('INVALID_RESPONSE');
  const bot = record(record(data.bots)[profile]);
  if (
    (bot.manager !== null && typeof bot.manager !== 'string') ||
    (bot.team !== null && typeof bot.team !== 'string')
  )
    throw new ClientError('INVALID_RESPONSE');
  return {
    revision: data.revision,
    role: decodeRole(bot.role),
    manager: bot.manager,
    team: bot.team,
  };
}

async function write<T>(action: () => Promise<T>): Promise<WriteOutcome<T>> {
  try {
    return { kind: 'confirmed', value: await action() };
  } catch (error) {
    const { code } = safeError(error);
    // Other failures can follow a native asset or metadata write. Never replay them.
    if (['STALE_REVISION', 'HANDLE_TAKEN', 'INVALID_REPORTING', 'INVALID_PHOTO'].includes(code))
      return { kind: 'refused', reason: code };
    return { kind: 'uncertain', evidence: { code } };
  }
}

export class WorkspaceDomain {
  constructor(private readonly bridge: Pick<BotBridgeClient, 'invoke'>) {}

  async describeWorkspace(): Promise<WorkspaceSnapshot> {
    return decodeWorkspaceSnapshot(await this.bridge.invoke('workspace.describe', {}));
  }

  async describeAgentCapabilities(profile: string) {
    return decodeAgentCapabilities(await this.bridge.invoke('agent.capabilities', { profile }));
  }

  attachTools(edit: {
    profile: string;
    expectedRevision: number;
    skills: string[];
    toolsets: string[];
  }) {
    return write(async () => {
      const result = record(
        await this.bridge.invoke('agent.attach', {
          profile: edit.profile,
          expected_revision: edit.expectedRevision,
          skills: edit.skills,
          toolsets: edit.toolsets,
        }),
      );
      if (result.state !== 'completed') throw new ClientError('INVALID_RESPONSE');
      return { state: 'completed' as const };
    });
  }

  selectModel(profile: string, expectedRevision: number, fingerprint: string) {
    return write(async () => {
      const result = record(
        await this.bridge.invoke('agent.model', {
          profile,
          source: 'default',
          expected: fingerprint,
          expected_revision: expectedRevision,
        }),
      );
      if (result.configured !== true) throw new ClientError('INVALID_RESPONSE');
      return { configured: true as const };
    });
  }

  selectMainPebble(profile: string, expectedRevision: number) {
    return write(async () => {
      const result = record(
        await this.bridge.invoke('workspace.set_orchestrator', {
          profile,
          expected_revision: expectedRevision,
        }),
      );
      if (
        result.orchestrator !== profile ||
        !Number.isSafeInteger(result.revision) ||
        Number(result.revision) <= expectedRevision
      )
        throw new ClientError('INVALID_RESPONSE');
      return { profile, revision: Number(result.revision) };
    });
  }

  onboardExisting(edit: ProfileEdit): Promise<WriteOutcome<ProfileReceipt>> {
    return this.saveProfile('agent.onboard', edit);
  }

  updateProfile(edit: ProfileEdit): Promise<WriteOutcome<ProfileReceipt>> {
    return this.saveProfile('bots.profile.update', edit);
  }

  updateRoleAssignment(edit: RoleAssignmentEdit) {
    return write(async () =>
      roleReceipt(
        await this.bridge.invoke('roles.update', {
          profile: edit.profile,
          expected_revision: edit.expectedRevision,
          role: edit.role,
          manager: edit.manager,
          team: edit.team,
        }),
        edit.profile,
      ),
    );
  }

  private saveProfile(operation: 'agent.onboard' | 'bots.profile.update', edit: ProfileEdit) {
    return write(async () =>
      profileReceipt(
        await this.bridge.invoke(operation, {
          profile: edit.target.profile,
          id: edit.target.id,
          expected_revision: edit.expectedRevision,
          name: edit.name,
          handle: edit.handle,
          appearance: edit.appearance,
          role: edit.role,
          manager: edit.manager,
          photo:
            edit.appearance.kind === 'photo' && edit.photo.kind === 'replace'
              ? edit.photo.data
              : null,
        }),
        edit.target.profile,
      ),
    );
  }
}
