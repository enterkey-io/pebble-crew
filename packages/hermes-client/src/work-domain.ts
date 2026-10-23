import { ClientError } from '@hermes-client/core';
import { record } from './json';
import type { SessionClient } from './session-client';

const statuses = [
  'triage',
  'todo',
  'scheduled',
  'ready',
  'running',
  'blocked',
  'review',
  'done',
  'archived',
] as const;
function text(value: unknown, limit = 1000): string {
  if (typeof value !== 'string' || value.length > limit) throw new ClientError('INVALID_RESPONSE');
  return value;
}
function nullableText(value: unknown, limit = 1000): string | null {
  return value == null ? null : text(value, limit);
}
function list<T>(value: unknown, decode: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 10000) throw new ClientError('INVALID_RESPONSE');
  return value.map(decode);
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new ClientError('INVALID_RESPONSE');
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  const found = choices.find((item) => value === item);
  if (found === undefined) throw new ClientError('INVALID_RESPONSE');
  return found;
}
function decodeBoard(value: unknown) {
  const board = record(value);
  return {
    slug: text(board.slug, 128),
    name: text(board.name, 1000),
    description: text(board.description, 50000),
    projectId: nullableText(board.project_id, 128),
    revision: text(board.revision, 64),
    mapping: choice(board.mapping, ['general', 'linked', 'unlinked', 'conflict']),
    count: integer(board.count),
  };
}
export type WorkBoard = ReturnType<typeof decodeBoard>;
export function decodeWorkCatalog(value: unknown) {
  const data = record(value),
    capabilities = record(data.capabilities);
  if (typeof capabilities.edit_details !== 'boolean') throw new ClientError('INVALID_RESPONSE');
  return {
    workspaceId: text(data.workspace_id, 128),
    boards: list(data.boards, decodeBoard),
    capabilities: {
      editDetails: capabilities.edit_details,
      plans: capabilities.plans === true,
      proactive: capabilities.proactive === true,
    },
    unlinkedProjects: list(data.unlinked_projects, (value) => {
      const project = record(value);
      return { id: text(project.id, 128), name: text(project.name) };
    }),
  };
}
export type WorkCatalog = ReturnType<typeof decodeWorkCatalog>;
export function decodeWorkTask(value: unknown) {
  const task = record(value);
  return {
    id: text(task.id, 128),
    title: text(task.title, 50000),
    body: nullableText(task.body, 500000) ?? '',
    assignee: nullableText(task.assignee, 128),
    priority: integer(task.priority),
    status: choice(task.status, statuses),
    projectId: nullableText(task.project_id, 128),
    result: nullableText(task.result, 500000),
    revision: text(task.revision, 64),
  };
}
export type WorkTask = ReturnType<typeof decodeWorkTask>;
export type WorkStatus = WorkTask['status'];
export const workMoveStatuses = [
  'triage',
  'todo',
  'ready',
  'blocked',
  'done',
  'archived',
] as const satisfies readonly WorkStatus[];
export type WorkMoveStatus = (typeof workMoveStatuses)[number];
function decodeBoardView(value: unknown) {
  const data = record(value);
  return {
    workspaceId: text(data.workspace_id, 128),
    board: decodeBoard(data.board),
    columns: list(data.columns, (value) => {
      const column = record(value);
      return { status: choice(column.status, statuses), tasks: list(column.tasks, decodeWorkTask) };
    }),
  };
}
export type WorkBoardView = ReturnType<typeof decodeBoardView>;
function decodeTaskView(value: unknown) {
  const data = record(value);
  return {
    workspaceId: text(data.workspace_id, 128),
    board: decodeBoard(data.board),
    task: decodeWorkTask(data.task),
    events: list(data.events ?? [], (value) => {
      const event = record(value);
      return {
        id: integer(event.id),
        kind: text(event.kind),
        createdAt: integer(event.created_at),
        actor: nullableText(event.actor),
        status: nullableText(event.status),
        summary: nullableText(event.summary, 500000),
      };
    }),
    runs: list(data.runs ?? [], (value) => {
      const run = record(value);
      return {
        id: integer(run.id),
        profile: nullableText(run.profile),
        status: text(run.status),
        startedAt: integer(run.started_at),
        endedAt: run.ended_at == null ? null : integer(run.ended_at),
        outcome: nullableText(run.outcome),
        summary: nullableText(run.summary, 500000),
      };
    }),
    comments: list(data.comments, (value) => {
      const comment = record(value);
      return {
        id: integer(comment.id),
        author: text(comment.author),
        body: text(comment.body, 500000),
        createdAt: integer(comment.created_at),
      };
    }),
    mentions: list(data.mentions ?? [], (value) => {
      const mention = record(value);
      return {
        id: text(mention.id),
        profile: text(mention.profile),
        commentId: integer(mention.comment_id),
        state: choice(mention.state, ['pending', 'sending', 'sent', 'uncertain', 'unavailable']),
      };
    }),
    dependencies: list(data.dependencies, (value) => {
      const task = record(value);
      return {
        id: text(task.id, 128),
        title: text(task.title, 50000),
        status: choice(task.status, statuses),
      };
    }),
  };
}
export type WorkTaskView = ReturnType<typeof decodeTaskView>;
export type WorkReceipt =
  | { kind: 'project'; id: string; board: string; projectId: string }
  | { kind: 'task'; id: string; board: string; taskId: string }
  | {
      kind: 'pending';
      id: string;
      state:
        | 'absent'
        | 'reserved'
        | 'project_created'
        | 'board_created'
        | 'task_created'
        | 'assigned'
        | 'uncertain';
    };
function decodeReceipt(value: unknown): WorkReceipt {
  const data = record(value),
    id = text(data.id, 128);
  if (data.state !== 'completed')
    return {
      kind: 'pending',
      id,
      state: choice(data.state, [
        'absent',
        'reserved',
        'project_created',
        'board_created',
        'task_created',
        'assigned',
        'uncertain',
      ]),
    };
  const board = text(data.board, 128);
  if (typeof data.task_id === 'string')
    return { kind: 'task', id, board, taskId: text(data.task_id, 128) };
  return { kind: 'project', id, board, projectId: text(data.project_id, 128) };
}
export type WorkReference = { workspaceId: string; board: string };
export type WorkTaskDraft = Pick<WorkTask, 'title' | 'body' | 'priority' | 'assignee'>;
type Mutation = { workspaceId: string; operationId: string };

export class WorkDomain {
  constructor(private readonly bridge: Pick<SessionClient, 'invoke'>) {}
  async catalog() {
    return decodeWorkCatalog(await this.bridge.invoke('work.describe', {}));
  }
  async board(ref: WorkReference) {
    const value = decodeBoardView(
      await this.bridge.invoke('work.board', { workspace_id: ref.workspaceId, board: ref.board }),
    );
    if (value.workspaceId !== ref.workspaceId || value.board.slug !== ref.board)
      throw new ClientError('INVALID_RESPONSE');
    return value;
  }
  async task(ref: WorkReference & { id: string }) {
    return decodeTaskView(
      await this.bridge.invoke('work.task', {
        workspace_id: ref.workspaceId,
        board: ref.board,
        id: ref.id,
      }),
    );
  }
  async receipt(ref: Mutation) {
    return decodeReceipt(
      await this.bridge.invoke('work.receipt', {
        workspace_id: ref.workspaceId,
        operation_id: ref.operationId,
      }),
    );
  }
  async createProject(ref: Mutation & { name: string; description: string }) {
    return decodeReceipt(
      await this.bridge.invoke('work.project.create', {
        workspace_id: ref.workspaceId,
        operation_id: ref.operationId,
        name: ref.name,
        description: ref.description,
      }),
    );
  }
  async updateProject(
    ref: Mutation & {
      projectId: string;
      expectedRevision: string;
      name: string;
      description: string;
    },
  ) {
    return decodeReceipt(
      await this.bridge.invoke('work.project.update', {
        workspace_id: ref.workspaceId,
        operation_id: ref.operationId,
        project_id: ref.projectId,
        expected_revision: ref.expectedRevision,
        name: ref.name,
        description: ref.description,
      }),
    );
  }
  async createTask(
    ref: Mutation & { board: string; draft: WorkTaskDraft; status?: WorkMoveStatus },
  ) {
    return decodeReceipt(
      await this.bridge.invoke('work.task.create', {
        workspace_id: ref.workspaceId,
        operation_id: ref.operationId,
        board: ref.board,
        ...ref.draft,
        ...(ref.status ? { status: ref.status } : {}),
      }),
    );
  }
  async updateTask(
    ref: Mutation & { board: string; id: string; expectedRevision: string; draft: WorkTaskDraft },
  ) {
    return decodeReceipt(
      await this.bridge.invoke('work.task.update', {
        workspace_id: ref.workspaceId,
        operation_id: ref.operationId,
        board: ref.board,
        id: ref.id,
        expected_revision: ref.expectedRevision,
        ...ref.draft,
      }),
    );
  }
  async moveTask(
    ref: Mutation & {
      board: string;
      id: string;
      expectedRevision: string;
      status: WorkStatus;
      beforeId?: string | null;
    },
  ) {
    return decodeReceipt(
      await this.bridge.invoke('work.task.move', {
        workspace_id: ref.workspaceId,
        operation_id: ref.operationId,
        board: ref.board,
        id: ref.id,
        expected_revision: ref.expectedRevision,
        status: ref.status,
        ...(ref.beforeId !== undefined ? { before_id: ref.beforeId } : {}),
      }),
    );
  }
  async comment(ref: Mutation & { board: string; id: string; body: string }) {
    return decodeReceipt(
      await this.bridge.invoke('work.task.comment', {
        workspace_id: ref.workspaceId,
        operation_id: ref.operationId,
        board: ref.board,
        id: ref.id,
        body: ref.body,
      }),
    );
  }
}
