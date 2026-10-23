import { ClientError } from '@hermes-client/core';
import { record } from './json';
import type { SessionClient } from './session-client';

function text(value: unknown, limit = 128): string {
  if (typeof value !== 'string' || value.length > limit) throw new ClientError('INVALID_RESPONSE');
  return value;
}
function list<T>(value: unknown, decode: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 1000) throw new ClientError('INVALID_RESPONSE');
  return value.map(decode);
}
function integer(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ClientError('INVALID_RESPONSE');
  return value;
}
function nullable(value: unknown) {
  return value === null ? null : text(value);
}
function boardRef(value: unknown) {
  const ref = record(value);
  return { catalogId: text(ref.catalog_id), projectId: text(ref.project_id), slug: text(ref.slug) };
}
export type PlanBoardRef = ReturnType<typeof boardRef>;
export const planStatuses = ['active', 'paused', 'completed', 'archived'] as const;
function plan(value: unknown) {
  const p = record(value);
  const status = planStatuses.find((status) => status === p.status);
  if (!status) throw new ClientError('INVALID_RESPONSE');
  return {
    id: text(p.id),
    title: text(p.title, 120),
    outcome: text(p.outcome, 2000),
    body: text(p.body, 12000),
    status,
    ownerId: nullable(p.owner_id),
    parentId: nullable(p.parent_id),
    crewIds: list(p.crew_ids, (value) => text(value)),
    boards: list(p.boards, boardRef),
  };
}
export type Plan = ReturnType<typeof plan>;
export type PlanDraft = Omit<Plan, 'id'> & { id: string | null };
function snapshot(value: unknown) {
  const data = record(value);
  if (typeof data.catalog_available !== 'boolean') throw new ClientError('INVALID_RESPONSE');
  return {
    workspaceId: text(data.workspace_id),
    revision: integer(data.revision),
    catalogAvailable: data.catalog_available,
    plans: list(data.plans, plan),
    boards: list(data.boards, (value) => ({
      ...boardRef(value),
      name: text(record(value).name, 1000),
    })),
    boardOutcomes: list(data.board_outcomes, (value) => {
      const o = record(value);
      return {
        board: boardRef(o.board),
        outcome: text(o.outcome, 2000),
        crewIds: list(o.crew_ids, (value) => text(value)),
      };
    }),
    unavailableBoards: list(data.unavailable_boards, boardRef),
  };
}
export type PlansSnapshot = ReturnType<typeof snapshot>;
function encodeBoard(ref: PlanBoardRef) {
  return { catalog_id: ref.catalogId, project_id: ref.projectId, slug: ref.slug };
}
function receipt(value: unknown) {
  const data = record(value);
  if (data.state !== 'completed' || data.kind !== 'plan') throw new ClientError('RPC_FAILED');
  return { id: text(data.id), revision: integer(data.revision) };
}
export class PlansDomain {
  constructor(private readonly bridge: Pick<SessionClient, 'invoke'>) {}
  async read(workspaceId: string) {
    const result = snapshot(await this.bridge.invoke('work.plans', { workspace_id: workspaceId }));
    if (result.workspaceId !== workspaceId) throw new ClientError('INVALID_RESPONSE');
    return result;
  }
  async receipt(workspaceId: string, operationId: string) {
    const data = record(
      await this.bridge.invoke('work.receipt', {
        workspace_id: workspaceId,
        operation_id: operationId,
      }),
    );
    if (data.id !== operationId) throw new ClientError('INVALID_RESPONSE');
    if (data.state === 'absent' || data.state === 'reserved') return false;
    receipt(data);
    return true;
  }
  async save(workspaceId: string, expectedRevision: number, operationId: string, draft: PlanDraft) {
    return receipt(
      await this.bridge.invoke('work.plan.save', {
        workspace_id: workspaceId,
        expected_revision: expectedRevision,
        operation_id: operationId,
        plan: {
          id: draft.id,
          title: draft.title,
          outcome: draft.outcome,
          body: draft.body,
          status: draft.status,
          owner_id: draft.ownerId,
          parent_id: draft.parentId,
          crew_ids: draft.crewIds,
          boards: draft.boards.map(encodeBoard),
        },
      }),
    );
  }
  async saveOutcome(
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    board: PlanBoardRef,
    outcome: string,
    crewIds: string[],
  ) {
    return receipt(
      await this.bridge.invoke('work.board.outcome.save', {
        workspace_id: workspaceId,
        expected_revision: expectedRevision,
        operation_id: operationId,
        outcome: { board: encodeBoard(board), outcome, crew_ids: crewIds },
      }),
    );
  }
}
