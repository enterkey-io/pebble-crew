import { ClientError } from '@hermes-client/core';
import type { BotBridgeClient } from './bridge';
import { record } from './json';
import { decodeWorkspaceSnapshot } from './workspace';
import type { WorkspaceBot, WorkspaceSnapshot } from './workspace';

export function reportingForest(workspace: WorkspaceSnapshot) {
  const bots = workspace.bots.filter((bot) => bot.enrolled);
  const byProfile = new Map(bots.map((bot) => [bot.profile, bot]));
  const children = new Map<string, WorkspaceBot[]>();
  const unattached: WorkspaceBot[] = [];
  const invalid: WorkspaceBot[] = [];
  for (const bot of bots) {
    if (bot.profile === workspace.orchestrator) continue;
    if (bot.manager === null) {
      unattached.push(bot);
      continue;
    }
    const visited = new Set([bot.profile]);
    let current: WorkspaceBot | undefined = bot;
    let valid = true;
    while (current?.manager) {
      const parent = byProfile.get(current.manager);
      if (
        !parent ||
        parent.available === false ||
        visited.has(parent.profile) ||
        (current.manager_id !== undefined && current.manager_id !== parent.id)
      ) {
        valid = false;
        break;
      }
      visited.add(parent.profile);
      current = parent;
    }
    if (!valid) invalid.push(bot);
    else children.set(bot.manager, [...(children.get(bot.manager) ?? []), bot]);
  }
  return {
    main: workspace.orchestrator ? byProfile.get(workspace.orchestrator) : undefined,
    children,
    unattached,
    invalid,
  };
}

export function decodeReporting(value: unknown) {
  const data = record(value);
  const workspace = decodeWorkspaceSnapshot(data.workspace);
  if (!workspace.reporting || !Array.isArray(data.changes) || data.changes.length > 50)
    throw new ClientError('INVALID_RESPONSE');
  const changes = data.changes.map((value) => {
    const entry = record(value);
    if (
      typeof entry.id !== 'string' ||
      typeof entry.actor !== 'string' ||
      typeof entry.state !== 'string' ||
      !['queued', 'applying', 'applied', 'refused', 'uncertain'].includes(entry.state)
    )
      throw new ClientError('INVALID_RESPONSE');
    const change = record(entry.change);
    if (
      typeof change.profile !== 'string' ||
      (change.instructions !== null && typeof change.instructions !== 'string')
    )
      throw new ClientError('INVALID_RESPONSE');
    return { id: entry.id, actor: entry.actor, state: entry.state, profile: change.profile };
  });
  return { workspace, changes };
}

export class ReportingDomain {
  constructor(private readonly client: Pick<BotBridgeClient, 'invoke'>) {}
  async read() {
    return decodeReporting(await this.client.invoke('reporting.describe', {}));
  }
  async setManagement(state: WorkspaceSnapshot, enabled: boolean) {
    if (!state.reporting) throw new ClientError('UNSUPPORTED');
    const result = record(
      await this.client.invoke('reporting.policy', {
        enabled,
        expected_revision: state.revision,
        policy_revision: state.reporting.policy_revision,
      }),
    );
    if (result.state !== 'completed') throw new ClientError('INVALID_RESPONSE');
    return this.read();
  }
}
