import { describe, it, expect } from 'vitest';
import { reportingForest } from './reporting';
import { decodeWorkspaceSnapshot } from './workspace';
function state() {
  return decodeWorkspaceSnapshot({
    id: 'owner',
    revision: 1,
    initialized: true,
    orchestrator: 'main',
    teams: [],
    bots: ['main', 'manager', 'child'].map((profile, index) => ({
      id: profile,
      profile,
      name: profile,
      handle: profile,
      description: '',
      managed: true,
      enrolled: true,
      canonical: true,
      manager: index === 2 ? 'manager' : null,
      manager_id: index === 2 ? 'manager' : null,
      team: null,
      appearance: { kind: 'shape', shape: 'pebble', color: 'iris' },
      role: {
        title: '',
        description: '',
        responsibilities: '',
        boundaries: '',
        expectedOutputs: '',
      },
    })),
  });
}
describe('reporting forest', () => {
  it('shows detached manager branches without inventing a root relationship', () => {
    const forest = reportingForest(state());
    expect(forest.main?.profile).toBe('main');
    expect(forest.unattached.map((bot) => bot.profile)).toEqual(['manager']);
    expect(forest.children.get('manager')?.map((bot) => bot.profile)).toEqual(['child']);
    expect(forest.invalid).toEqual([]);
  });
  it('includes hidden agents while rejecting reused manager identities', () => {
    const workspace = state();
    const manager = workspace.bots[1]!;
    manager.hidden = true;
    expect(reportingForest(workspace).children.get('manager')).toHaveLength(1);
    manager.id = 'replacement';
    expect(reportingForest(workspace).invalid.map((bot) => bot.profile)).toEqual(['child']);
  });
  it('renders malformed cyclic imports as repairable cards rather than recursive branches', () => {
    const workspace = state();
    workspace.bots[1]!.manager = 'child';
    workspace.bots[1]!.manager_id = 'child';
    const forest = reportingForest(workspace);
    expect(forest.invalid.map((bot) => bot.profile)).toEqual(['manager', 'child']);
    expect(forest.children.size).toBe(0);
  });
});
