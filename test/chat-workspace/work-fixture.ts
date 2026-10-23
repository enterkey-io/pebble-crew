import type { BrowserContext } from '@playwright/test';
import { installFixture } from './fixtures';

export async function installWorkFixture(
  context: BrowserContext,
  options: { coordination?: boolean } = {},
) {
  const workspace = await installFixture(context, { projects: true });
  let revision = 1;
  const nextRevision = () => (++revision).toString(16).padStart(64, '0');
  const boards = [
    {
      slug: 'default',
      name: 'General tasks',
      description: '',
      project_id: null as string | null,
      revision: nextRevision(),
      mapping: 'general',
      count: 0,
    },
  ];
  type Task = {
    id: string;
    title: string;
    body: string;
    priority: number;
    assignee: string | null;
    project_id: string | null;
    status: string;
    result: string | null;
    revision: string;
  };
  const tasks = new Map<string, Task[]>();
  const comments = new Map<
    string,
    { id: number; author: string; body: string; created_at: number }[]
  >();
  const history = new Map<
    string,
    {
      id: number;
      kind: string;
      created_at: number;
      actor: string | null;
      status: string | null;
      summary: string | null;
    }[]
  >();
  const runs = new Map<
    string,
    {
      id: number;
      profile: string;
      status: string;
      started_at: number;
      ended_at: number;
      outcome: string;
      summary: string;
    }[]
  >();
  const receipts = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  let moveResponse: Promise<void> | undefined;
  let loseNextCreate = false;
  let interruptNextProject = false;
  const projectAttempts: string[] = [];
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (!operation.startsWith('work.')) return route.fallback();
    calls.push(operation);
    if (operation === 'work.describe') {
      return route.fulfill({
        json: {
          result: {
            workspace_id: workspace.state.id,
            capabilities: {
              edit_details: true,
              plans: !!options.coordination,
              proactive: !!options.coordination,
            },
            boards,
            unlinked_projects: [],
          },
        },
      });
    }
    if (operation === 'work.receipt')
      return route.fulfill({
        json: {
          result: receipts.get(params.operation_id) ?? { id: params.operation_id, state: 'absent' },
        },
      });
    if (params.workspace_id !== workspace.state.id)
      return route.fulfill({ status: 400, json: { code: 'INVALID_PARAMETERS' } });
    if (operation === 'work.project.create') {
      projectAttempts.push(params.operation_id);
      const previous = receipts.get(params.operation_id);
      if (previous) {
        if (previous.state !== 'completed') {
          boards.find((board) => board.slug === previous.board)!.mapping = 'linked';
          previous.state = 'completed';
        }
        return route.fulfill({ json: { result: previous } });
      }
      const slug = 'pebble-' + params.operation_id;
      const project_id = 'project-' + boards.length;
      boards.push({
        slug,
        name: params.name,
        description: params.description,
        project_id,
        revision: nextRevision(),
        mapping: 'linked',
        count: 0,
      });
      const result = { id: params.operation_id, state: 'completed', board: slug, project_id };
      receipts.set(params.operation_id, result);
      if (interruptNextProject) {
        interruptNextProject = false;
        boards.at(-1)!.mapping = 'unlinked';
        result.state = 'board_created';
      }
      return route.fulfill({ json: { result } });
    }
    const board = boards.find((b) => b.slug === params.board);
    if (operation === 'work.project.update') {
      const project = boards.find((b) => b.project_id === params.project_id)!;
      if (project.revision !== params.expected_revision)
        return route.fulfill({ status: 409, json: { code: 'STALE_REVISION' } });
      Object.assign(project, {
        name: params.name,
        description: params.description,
        revision: nextRevision(),
      });
      const result = {
        id: params.operation_id,
        state: 'completed',
        board: project.slug,
        project_id: project.project_id,
      };
      receipts.set(params.operation_id, result);
      return route.fulfill({ json: { result } });
    }
    if (!board) return route.fulfill({ status: 400, json: { code: 'INVALID_PARAMETERS' } });
    if (operation === 'work.board')
      return route.fulfill({
        json: {
          result: {
            workspace_id: workspace.state.id,
            board,
            columns: [
              'triage',
              'todo',
              'scheduled',
              'ready',
              'running',
              'blocked',
              'review',
              'done',
            ].map((status) => ({
              status,
              tasks: (tasks.get(board.slug) ?? []).filter((t) => t.status === status),
            })),
          },
        },
      });
    if (operation === 'work.task.create') {
      const previous = receipts.get(params.operation_id);
      if (previous) return route.fulfill({ json: { result: previous } });
      const task: Task = {
        id: 'task-' + revision,
        title: params.title,
        body: params.body,
        priority: params.priority,
        assignee: params.assignee,
        status: params.status ?? 'triage',
        project_id: board.project_id,
        result: null,
        revision: nextRevision(),
      };
      const rows = tasks.get(board.slug) ?? [];
      rows.push(task);
      tasks.set(board.slug, rows);
      board.count = rows.length;
      const result = {
        id: params.operation_id,
        state: 'completed',
        board: board.slug,
        task_id: task.id,
        revision: task.revision,
      };
      receipts.set(params.operation_id, result);
      if (loseNextCreate) {
        loseNextCreate = false;
        return route.abort('failed');
      }
      return route.fulfill({ json: { result } });
    }
    const task = tasks.get(board.slug)?.find((t) => t.id === params.id);
    if (!task) return route.fulfill({ status: 400, json: { code: 'INVALID_PARAMETERS' } });
    if (operation === 'work.task')
      return route.fulfill({
        json: {
          result: {
            workspace_id: workspace.state.id,
            board,
            task,
            comments: comments.get(task.id) ?? [],
            events: history.get(task.id) ?? [],
            runs: runs.get(task.id) ?? [],
            dependencies: [],
          },
        },
      });
    if (operation === 'work.task.move') {
      if (task.revision !== params.expected_revision)
        return route.fulfill({ status: 409, json: { code: 'STALE_REVISION' } });
      if (moveResponse) {
        const wait = moveResponse;
        moveResponse = undefined;
        await wait;
      }
      if (task.status !== params.status) {
        task.status = params.status;
        task.revision = nextRevision();
      }
      if ('before_id' in params) {
        const rest = (tasks.get(board.slug) ?? []).filter((row) => row.id !== task.id);
        const column = rest.filter((row) => row.status === task.status);
        const index =
          params.before_id === null
            ? column.length
            : column.findIndex((row) => row.id === params.before_id);
        if (index < 0) return route.fulfill({ status: 409, json: { code: 'STALE_REVISION' } });
        column.splice(index, 0, task);
        tasks.set(board.slug, [...rest.filter((row) => row.status !== task.status), ...column]);
      }
    }
    if (operation === 'work.task.update') {
      if (task.revision !== params.expected_revision)
        return route.fulfill({ status: 409, json: { code: 'STALE_REVISION' } });
      Object.assign(task, {
        title: params.title,
        body: params.body,
        assignee: params.assignee,
        priority: params.priority,
        revision: nextRevision(),
      });
    }
    if (operation === 'work.task.comment') {
      const rows = comments.get(task.id) ?? [];
      rows.push({
        id: rows.length + 1,
        author: 'owner',
        body: params.body,
        created_at: 1700000000,
      });
      comments.set(task.id, rows);
    }
    const result = {
      id: params.operation_id,
      state: 'completed',
      board: board.slug,
      task_id: task.id,
      revision: task.revision,
    };
    receipts.set(params.operation_id, result);
    return route.fulfill({ json: { result } });
  });
  return {
    workspace: workspace.state,
    boards,
    tasks,
    calls,
    nextRevision,
    history,
    runs,
    holdNextMove: (wait: Promise<void>) => {
      moveResponse = wait;
    },
    projectAttempts,
    interruptNextProject: () => {
      interruptNextProject = true;
    },
    loseNextCreate: () => {
      loseNextCreate = true;
    },
  };
}
