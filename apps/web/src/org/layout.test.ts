import { describe, expect, it } from 'vitest';
import { orgCard, organizationLayout } from './layout';
import { fixtureState } from '../../../../test/chat-workspace/fixtures';

describe('organization diagram', () => {
  it('centers fixed-size managers above their reports with exact card-to-card connectors', () => {
    const state = fixtureState();
    state.bots = state.bots.slice(0, 5);
    state.bots[2]!.manager = 'mica';
    state.bots[4]!.manager = 'mica';
    const layout = organizationLayout(state);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + orgCard.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + orgCard.height).toBeLessThanOrEqual(layout.height);
      const siblings = layout.nodes.filter((other) => other.y === node.y && other !== node);
      expect(
        siblings.every((other) => Math.abs(other.x - node.x) >= orgCard.width + orgCard.gap),
      ).toBe(true);
    }
    const byProfile = new Map(layout.nodes.map((node) => [node.bot.profile, node]));
    expect(layout.links).toHaveLength(4);
    for (const link of layout.links) {
      const parent = byProfile.get(link.parent)!;
      const child = byProfile.get(link.child)!;
      expect(child.y - parent.y).toBe(orgCard.height + orgCard.levelGap);
      expect(link.path).toBe(
        `M ${parent.x + orgCard.width / 2} ${parent.y + orgCard.height} V ${child.y - orgCard.levelGap / 2} H ${child.x + orgCard.width / 2} V ${child.y}`,
      );
    }
    const main = byProfile.get('arlo')!;
    const reports = layout.links
      .filter((link) => link.parent === 'arlo')
      .map((link) => byProfile.get(link.child)!);
    expect(main.x + orgCard.width / 2).toBe(
      (Math.min(...reports.map((node) => node.x)) +
        Math.max(...reports.map((node) => node.x + orgCard.width))) /
        2,
    );
  });
  it('retains unattached subtrees without drawing a false connection to Main Pebble', () => {
    const state = fixtureState();
    state.bots = state.bots.slice(0, 4);
    state.bots[1]!.manager = null;
    state.bots[2]!.manager = 'mica';
    const layout = organizationLayout(state);
    expect(layout.groups.map((group) => group.id)).toEqual(['reporting', 'unattached']);
    expect(layout.links).toContainEqual(
      expect.objectContaining({ parent: 'mica', child: 'rowan' }),
    );
    expect(layout.links.some((link) => link.child === 'mica')).toBe(false);
    expect(
      layout.nodes.filter((node) => node.group === 'unattached').map((node) => node.bot.profile),
    ).toEqual(['mica', 'rowan']);
  });
  it('keeps cyclic or replaced identities in a disconnected repair group', () => {
    const state = fixtureState();
    state.bots = state.bots.slice(0, 3);
    state.bots[1]!.manager = 'rowan';
    state.bots[2]!.manager = 'mica';
    const layout = organizationLayout(state);
    expect(layout.links).toEqual([]);
    expect(layout.nodes.filter((node) => node.group === 'invalid')).toHaveLength(2);
  });
});
