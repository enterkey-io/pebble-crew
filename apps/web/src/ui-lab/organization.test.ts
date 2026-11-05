import { describe, it, expect } from 'vitest';
import { initialOrganization } from './organization-fixture';
import {
  addShortcut,
  removeShortcut,
  placeItem,
  placePebble,
  nudgeItem,
  nudgeSection,
  moveSection,
  removeSection,
  readRailDrag,
  organizationState,
} from '../ui/organization';
import type { Organization, RailItem } from '../ui/organization';
const sample = () => structuredClone(initialOrganization);
const all = (org: Organization) => org.sections.flatMap((s) => s.items);
const group: RailItem = {
  kind: 'group',
  id: 'native-room',
  readKey: 'room:native-room:1700000000.123456',
  placementId: 'group-placement',
};
describe('independent sections and explicit groups', () => {
  it('moves a row by placement without changing its conversation identity', () => {
    const org = sample();
    org.sections[1]!.items.push(group);
    const next = placeItem(org, group.placementId, 'studio', 'row-sample-4');
    expect(next.sections[2]!.items[0]).toEqual(group);
    expect(all(next).length).toBe(all(org).length);
    expect(org.sections[1]!.items.at(-1)).toEqual(group);
  });
  it('preserves independent shortcut placements and changes only the selected copy', () => {
    const org = addShortcut(sample(), 'sample-4', 'shortcut-copy');
    expect(all(org).filter((i) => i.id === 'sample-4')).toHaveLength(2);
    const moved = placeItem(org, 'shortcut-copy', 'personal');
    expect(moved.sections[2]!.items.some((i) => i.id === 'sample-4')).toBe(true);
    expect(removeShortcut(moved, 'sample-4')).toEqual(sample());
  });
  it('will not move to an obsolete destination or missing row anchor', () => {
    const org = sample();
    expect(placeItem(org, 'row-sample-4', 'missing')).toBe(org);
    expect(placeItem(org, 'row-sample-4', 'personal', 'missing')).toBe(org);
    expect(placeItem(org, 'row-sample-4', 'studio', 'row-sample-4')).toBe(org);
  });
  it('keeps groups, direct rows and every placement when removing a section', () => {
    const org = sample();
    org.sections[2]!.items.push(group);
    const next = removeSection(org, 'studio');
    expect(next.sections[0]!.items).toEqual(org.sections[2]!.items);
    expect(
      all(next)
        .map((i) => i.placementId)
        .sort(),
    ).toEqual(
      all(org)
        .map((i) => i.placementId)
        .sort(),
    );
    expect(removeSection(next, 'pebbles')).toBe(next);
  });
  it('reorders rows and sections by keyboard, preserving the unnamed list', () => {
    const org = sample(),
      item = org.sections[1]!.items[1]!;
    expect(nudgeItem(org, item, -1).sections[1]!.items[0]).toEqual(item);
    expect(nudgeSection(org, 'studio', -1).sections.map((s) => s.id)).toEqual([
      'pebbles',
      'studio',
      'personal',
    ]);
    expect(moveSection(org, 'pebbles', 'studio')).toBe(org);
    expect(
      placePebble(org, 'sample-4', { kind: 'section', id: 'personal' }).sections[1]!.items.at(-1)
        ?.id,
    ).toBe('sample-4');
  });
  it('accepts only current drag identities, never a room-membership mutation', () => {
    const org = sample();
    expect(
      readRailDrag(JSON.stringify({ kind: 'placement', id: 'row-sample-4' }), org, []),
    ).toEqual({ kind: 'placement', id: 'row-sample-4' });
    expect(readRailDrag(JSON.stringify({ kind: 'crew', id: 'studio' }), org, [])).toBeUndefined();
    expect(
      readRailDrag(JSON.stringify({ kind: 'placement', id: 'absent' }), org, []),
    ).toBeUndefined();
  });
  it('decodes schema 3 with opaque native group read keys and rejects duplicate placements/old writers', () => {
    const value = { schema: 3, revision: 2, ...sample() };
    value.sections[0]!.items.push(group);
    expect(organizationState(value).sections[0]!.items[0]).toEqual(group);
    expect(() => organizationState({ ...value, schema: 2 })).toThrow();
    value.sections[1]!.items.push(group);
    expect(() => organizationState(value)).toThrow();
  });
});
