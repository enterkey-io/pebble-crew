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
});
