import { ClientError } from '@hermes-client/core';
import { record } from './json';
import type { SessionClient } from './session-client';
function text(value: unknown, max = 6000) {
  if (typeof value !== 'string' || value.length > max) throw new ClientError('INVALID_RESPONSE');
  return value;
}
export const routineDays = ['weekdays', 'daily', 'weekly'] as const;
function days(value: unknown) {
  const found = routineDays.find((v) => v === value);
  if (!found) throw new ClientError('INVALID_RESPONSE');
  return found;
}
export type RoutineDraft = {
  id: string;
  name: string;
  prompt: string;
  time: string;
  days: ReturnType<typeof days>;
  tools: string[];
};
function suggestion(value: unknown): RoutineDraft {
  const data = record(value);
  if (!Array.isArray(data.tools) || data.tools.length > 100)
    throw new ClientError('INVALID_RESPONSE');
  return {
    id: text(data.id, 128),
    name: text(data.name, 120),
    prompt: text(data.prompt),
    time: text(data.time, 5),
    days: days(data.days),
    tools: data.tools.map((v) => text(v, 160)),
  };
}
function receipt(value: unknown) {
  const data = record(value);
  if (data.state === 'reserved' || data.state === 'absent') return { kind: 'not-saved' as const };
  if (data.kind !== 'routine' || !['completed', 'uncertain'].includes(String(data.state)))
    throw new ClientError('INVALID_RESPONSE');
  return data.state === 'completed'
    ? {
        kind: 'completed' as const,
        jobId: text(data.job_id, 128),
        name: text(data.name, 120),
        enabled: data.enabled !== false,
      }
    : { kind: 'uncertain' as const };
}
export class ProactiveDomain {
  constructor(private readonly bridge: Pick<SessionClient, 'invoke'>) {}
  async status(workspaceId: string) {
    const data = record(
      await this.bridge.invoke('work.proactive.status', { workspace_id: workspaceId }),
    );
    if (data.workspace_id !== workspaceId || typeof data.seen !== 'boolean')
      throw new ClientError('INVALID_RESPONSE');
    return {
      mainId: text(data.main_id, 128),
      mainName: text(data.main_name, 128),
      timezone: text(data.timezone, 128),
      seen: data.seen,
      routines:
        data.routines === undefined
          ? []
          : (() => {
              if (!Array.isArray(data.routines) || data.routines.length > 100)
                throw new ClientError('INVALID_RESPONSE');
              return data.routines.map((value) => {
                const row = record(value);
                const state = ['completed', 'uncertain', 'reserved'].find(
                  (state) => state === row.state,
                );
                if (!state) throw new ClientError('INVALID_RESPONSE');
                return { id: text(row.id, 128), name: text(row.name, 120), state };
              });
            })(),
    };
  }
  async suggest(workspaceId: string) {
    const data = record(
      await this.bridge.invoke('work.proactive.suggest', { workspace_id: workspaceId }),
    );
    if (
      data.workspace_id !== workspaceId ||
      !Array.isArray(data.suggestions) ||
      data.suggestions.length > 10
    )
      throw new ClientError('INVALID_RESPONSE');
    return {
      id: text(data.proposal_id, 128),
      mainId: text(data.main_id, 128),
      mainName: text(data.main_name, 128),
      timezone: text(data.timezone, 128),
      suggestions: data.suggestions.map(suggestion),
    };
  }
  async enable(
    workspaceId: string,
    proposalId: string,
    timezone: string,
    operationId: string,
    draft: RoutineDraft,
  ) {
    return receipt(
      await this.bridge.invoke('work.proactive.enable', {
        workspace_id: workspaceId,
        proposal_id: proposalId,
        operation_id: operationId,
        template_id: draft.id,
        prompt: draft.prompt,
        time: draft.time,
        days: draft.days,
        timezone,
      }),
    );
  }
  async receipt(workspaceId: string, operationId: string) {
    return receipt(
      await this.bridge.invoke('work.proactive.receipt', {
        workspace_id: workspaceId,
        operation_id: operationId,
      }),
    );
  }
  async skip(workspaceId: string) {
    await this.bridge.invoke('work.proactive.skip', { workspace_id: workspaceId });
  }
}
