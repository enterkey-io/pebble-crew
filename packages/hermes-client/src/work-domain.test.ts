import { describe, it, expect, vi } from 'vitest';
import { decodeWorkCatalog, decodeWorkTask, WorkDomain } from './work-domain';

describe('native work boundary', () => {
  it('sends explicit board and workspace scope and preserves the retry identity', async () => {
    const invoke = vi.fn().mockResolvedValue({
      id: 'save-1',
      state: 'completed',
      board: 'research',
      task_id: 'task-1',
    });
    const domain = new WorkDomain({ invoke });
    const input = {
      workspaceId: 'owner-1',
      operationId: 'save-1',
      board: 'research',
      draft: {
        title: 'Verify sources',
        body: '- [ ] Read originals',
        assignee: 'mica',
        priority: 0,
      },
    };
    expect(await domain.createTask(input)).toEqual({
      kind: 'task',
      id: 'save-1',
      board: 'research',
      taskId: 'task-1',
    });
    expect(invoke).toHaveBeenCalledWith('work.task.create', {
      workspace_id: 'owner-1',
      operation_id: 'save-1',
      board: 'research',
      ...input.draft,
    });
  });
  it('does not mistake a partial or uncertain receipt for a saved task', async () => {
    const domain = new WorkDomain({
      invoke: vi.fn().mockResolvedValue({
        id: 'save-1',
        state: 'assigned',
        board: 'research',
        task_id: 'task-1',
      }),
    });
    expect(await domain.receipt({ workspaceId: 'owner-1', operationId: 'save-1' })).toEqual({
      kind: 'pending',
      id: 'save-1',
      state: 'assigned',
    });
  });
  it('rejects a board response for another workspace or board', async () => {
    const board = {
      slug: 'research',
      name: 'Research',
      description: '',
      project_id: null,
      revision: 'revision-1',
      mapping: 'unlinked',
      count: 0,
    };
    const invoke = vi.fn().mockResolvedValue({ workspace_id: 'owner-2', board, columns: [] });
    const domain = new WorkDomain({ invoke });
    await expect(domain.board({ workspaceId: 'owner-1', board: 'research' })).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
    invoke.mockResolvedValue({
      workspace_id: 'owner-1',
      board: { ...board, slug: 'other' },
      columns: [],
    });
    await expect(domain.board({ workspaceId: 'owner-1', board: 'research' })).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
    invoke.mockResolvedValue({ workspace_id: 'owner-1', board, columns: [] });
    await expect(
      domain.board({ workspaceId: 'owner-1', board: 'research' }),
    ).resolves.toMatchObject({ workspaceId: 'owner-1', board: { slug: 'research' } });
  });
  it('requires actual field-edit capability and rejects malformed task states', () => {
    expect(
      decodeWorkCatalog({
        workspace_id: 'owner-1',
        capabilities: { edit_details: false },
        boards: [],
        unlinked_projects: [],
      }).capabilities.editDetails,
    ).toBe(false);
    expect(() =>
      decodeWorkCatalog({
        workspace_id: 'owner-1',
        capabilities: { edit_details: 'yes' },
        boards: [],
        unlinked_projects: [],
      }),
    ).toThrow();
    expect(() =>
      decodeWorkTask({
        id: 'task-1',
        title: 'Task',
        body: '',
        assignee: null,
        priority: 0,
        project_id: null,
        result: null,
        status: 'pretend-done',
        revision: 'x'.repeat(64),
      }),
    ).toThrow();
  });
  it('moves a task only with explicit scope, current revision and the original operation identity', async () => {
    const invoke = vi.fn().mockResolvedValue({
      id: 'move-1',
      state: 'completed',
      board: 'research',
      task_id: 'task-1',
    });
    const domain = new WorkDomain({ invoke });
    await domain.moveTask({
      workspaceId: 'owner-1',
      operationId: 'move-1',
      board: 'research',
      id: 'task-1',
      expectedRevision: 'revision-1',
      status: 'todo',
    });
    expect(invoke).toHaveBeenCalledWith('work.task.move', {
      workspace_id: 'owner-1',
      operation_id: 'move-1',
      board: 'research',
      id: 'task-1',
      expected_revision: 'revision-1',
      status: 'todo',
    });
  });
});
