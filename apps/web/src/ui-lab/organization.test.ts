import { initialOrganization } from './organization-fixture';
import { describe, it, expect } from 'vitest';
import {
  nudgeItem,
  nudgeSection,
  placeCrew,
  placePebble,
  readRailDrag,
  reorderSection,
  sectionChoiceLabel,
  setCrewMembers,
} from '../ui/organization';
import type { Organization } from '../ui/organization';
function occurrences(org: Organization, id: string) {
  return (
    org.sections.flatMap((s) => s.items).filter((i) => i.kind === 'pebble' && i.id === id).length +
    org.crews.flatMap((c) => c.members).filter((p) => p === id).length
  );
}
describe('reference organization', () => {
  it('edits crew membership in one operation, returning removed members to the unsectioned list', () => {
    const root = { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [] };
    const org = { ...initialOrganization, sections: [root, ...initialOrganization.sections] };
    const next = setCrewMembers(org, 'studio', ['sample-2', 'sample-5']);
    expect(next.crews[0]!.members).toEqual(['sample-2', 'sample-5']);
    expect(next.sections[0]!.items).toEqual([{ kind: 'pebble', id: 'sample-4' }]);
    for (const id of ['sample-2', 'sample-4', 'sample-5']) expect(occurrences(next, id)).toBe(1);
    expect(initialOrganization.crews[0]!.members).toEqual(['sample-4', 'sample-5']);
  });
  it('keeps the unsectioned destination out of section ordering and calls it None in menus', () => {
    const root = { id: 'pebbles', name: 'Pebbles', collapsed: true, items: [] };
    const org = {
      ...initialOrganization,
      sections: [initialOrganization.sections[0]!, root, initialOrganization.sections[1]!],
    };
    expect(sectionChoiceLabel(root)).toBe('None');
    expect(nudgeSection(org, 'pebbles', 1)).toBe(org);
    expect(reorderSection(org, 'pebbles', 'personal')).toBe(org);
    expect(nudgeSection(org, 'crews', -1).sections.map((s) => s.id)).toEqual([
      'pebbles',
      'crews',
      'personal',
    ]);
  });
  it('reorders visible rows without treating the pin shelf as intervening rows', () => {
    expect(
      nudgeItem(initialOrganization, { kind: 'pebble', id: 'sample-2' }, -1, [
        'sample-0',
        'sample-1',
      ]),
    ).toBe(initialOrganization);
    expect(
      nudgeItem(initialOrganization, { kind: 'pebble', id: 'sample-3' }, -1, [
        'sample-0',
        'sample-1',
      ]).sections[0]!.items.map((i) => i.id),
    ).toEqual(['sample-0', 'sample-1', 'sample-3', 'sample-2']);
  });
  it('moves one identity between sections and crews without duplicate membership or deletion', () => {
    const moved = placePebble(initialOrganization, 'sample-2', { kind: 'crew', id: 'studio' });
    expect(moved.crews[0]!.members).toEqual(['sample-4', 'sample-5', 'sample-2']);
    expect(occurrences(moved, 'sample-2')).toBe(1);
    const again = placePebble(moved, 'sample-2', { kind: 'crew', id: 'studio' });
    expect(again).toEqual(moved);
    const back = placePebble(moved, 'sample-2', { kind: 'section', id: 'personal' }, 'sample-0');
    expect(back.sections[0]!.items[0]).toEqual({ kind: 'pebble', id: 'sample-2' });
    expect(occurrences(back, 'sample-2')).toBe(1);
    expect(initialOrganization.crews[0]!.members).toEqual(['sample-4', 'sample-5']);
  });
  it('reorders sections, members and crew placement with bounded no-op edges', () => {
    expect(nudgeSection(initialOrganization, 'personal', -1)).toBe(initialOrganization);
    expect(
      reorderSection(initialOrganization, 'crews', 'personal').sections.map((s) => s.id),
    ).toEqual(['crews', 'personal']);
    expect(
      nudgeItem(initialOrganization, { kind: 'pebble', id: 'sample-5' }, -1).crews[0]!.members,
    ).toEqual(['sample-5', 'sample-4']);
    const moved = placeCrew(initialOrganization, 'studio', 'personal', 'sample-2');
    expect(moved.sections[1]!.items).toEqual([]);
    expect(moved.sections[0]!.items[2]).toEqual({ kind: 'crew', id: 'studio' });
    expect(moved.crews).toEqual(initialOrganization.crews);
  });
  it('accepts only known local drag identities at the external drop boundary', () => {
    for (const value of [
      'bad',
      'null',
      '{"kind":"pebble","id":"unknown"}',
      '{"kind":"file","id":"studio"}',
    ])
      expect(readRailDrag(value, initialOrganization, ['sample-0'])).toBeUndefined();
    expect(
      readRailDrag('{"kind":"pebble","id":"sample-0"}', initialOrganization, ['sample-0']),
    ).toEqual({ kind: 'pebble', id: 'sample-0' });
  });
});
