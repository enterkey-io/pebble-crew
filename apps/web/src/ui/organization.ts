export { organizationState } from '@hermes-client/protocol';
export type { Organization, OrganizationState, RailItem, Section } from '@hermes-client/protocol';
import type { Organization, RailItem, Section } from '@hermes-client/protocol';

export type Placement = { kind: 'section'; id: string };
export type RailDrag =
  | { kind: 'section'; id: string }
  | { kind: 'placement'; id: string }
  | { kind: 'pebble'; id: string };
export type OrganizationEditor =
  | { kind: 'new-section'; placementId?: string; pebbleId?: string }
  | { kind: 'edit-section'; id: string }
  | { kind: 'new-group-chat' };
export const SYSTEM_SECTIONS = { pebbles: 'Pebbles' } as const;
export function isSystemSection(id: string) {
  return id === 'pebbles';
}
export function sectionChoiceLabel(section: Pick<Section, 'id' | 'name'>) {
  return isSystemSection(section.id) ? 'None' : section.name;
}
export function placementOf(org: Organization, id: string) {
  const section =
    org.sections.find((s) =>
      s.items.some((i) => i.kind === 'pebble' && i.id === id && !i.shortcut),
    ) ?? org.sections.find((s) => s.items.some((i) => i.kind === 'pebble' && i.id === id));
  return section ? { kind: 'section' as const, id: section.id } : undefined;
}
export function hasShortcut(org: Organization, id: string) {
  return org.sections.some((s) =>
    s.items.some((i) => i.kind === 'pebble' && i.id === id && i.shortcut),
  );
}
export function addShortcut(org: Organization, id: string, placementId: string): Organization {
  if (hasShortcut(org, id)) return org;
  return {
    sections: org.sections.map((s) =>
      s.id === 'pebbles'
        ? { ...s, items: [{ kind: 'pebble', id, placementId, shortcut: true }, ...s.items] }
        : s,
    ),
  };
}
export function removeShortcut(org: Organization, id: string): Organization {
  if (
    !org.sections.some((s) =>
      s.items.some((i) => i.kind === 'pebble' && i.id === id && !i.shortcut),
    )
  )
    return org;
  return {
    sections: org.sections.map((s) => ({
      ...s,
      items: s.items.filter((i) => i.kind !== 'pebble' || i.id !== id || !i.shortcut),
    })),
  };
}
export function placeItem(
  org: Organization,
  placementId: string,
  sectionId: string,
  beforeId?: string,
): Organization {
  if (beforeId === placementId) return org;
  const item = org.sections.flatMap((s) => s.items).find((i) => i.placementId === placementId);
  const target = org.sections.find((s) => s.id === sectionId);
  if (
    !item ||
    !target ||
    (beforeId !== undefined && !target.items.some((i) => i.placementId === beforeId))
  )
    return org;
  return {
    sections: org.sections.map((s) => {
      const items = s.items.filter((i) => i.placementId !== placementId);
      if (s.id === sectionId)
        items.splice(
          beforeId === undefined
            ? items.length
            : items.findIndex((i) => i.placementId === beforeId),
          0,
          item,
        );
      return { ...s, items };
    }),
  };
}
export function placePebble(
  org: Organization,
  id: string,
  target: Placement,
  beforeId?: string,
): Organization {
  const item =
    org.sections
      .flatMap((s) => s.items)
      .find((i) => i.kind === 'pebble' && i.id === id && !i.shortcut) ??
    org.sections.flatMap((s) => s.items).find((i) => i.kind === 'pebble' && i.id === id);
  return item ? placeItem(org, item.placementId, target.id, beforeId) : org;
}
export function moveSection(org: Organization, id: string, beforeId?: string): Organization {
  if (
    isSystemSection(id) ||
    id === beforeId ||
    (beforeId !== undefined && !org.sections.some((s) => s.id === beforeId))
  )
    return org;
  const section = org.sections.find((s) => s.id === id);
  if (!section) return org;
  const sections = org.sections.filter((s) => s.id !== id);
  sections.splice(
    beforeId === undefined
      ? sections.length
      : Math.max(
          1,
          sections.findIndex((s) => s.id === beforeId),
        ),
    0,
    section,
  );
  return { sections };
}
export function nudgeSection(org: Organization, id: string, direction: -1 | 1): Organization {
  const index = org.sections.findIndex((s) => s.id === id),
    target = index + direction;
  if (index <= 0 || target <= 0 || target >= org.sections.length) return org;
  const sections = [...org.sections];
  [sections[index], sections[target]] = [sections[target]!, sections[index]!];
  return { sections };
}
export function nudgeItem(
  org: Organization,
  item: RailItem,
  direction: -1 | 1,
  pinnedIds: string[] = [],
): Organization {
  const section = org.sections.find((s) => s.items.some((i) => i.placementId === item.placementId));
  if (!section) return org;
  const visible = section.items.filter(
    (i) => i.kind !== 'pebble' || i.shortcut || !pinnedIds.includes(i.id),
  );
  const index = visible.findIndex((i) => i.placementId === item.placementId),
    adjacent = visible[index + direction];
  if (!adjacent) return org;
  const next = direction === -1 ? adjacent.placementId : visible[index + 2]?.placementId;
  return placeItem(org, item.placementId, section.id, next);
}
export function removeSection(org: Organization, id: string): Organization {
  if (isSystemSection(id)) return org;
  const section = org.sections.find((s) => s.id === id);
  return section
    ? {
        sections: org.sections
          .filter((s) => s.id !== id)
          .map((s) => (s.id === 'pebbles' ? { ...s, items: [...s.items, ...section.items] } : s)),
      }
    : org;
}
export function readRailDrag(
  raw: string,
  org: Organization,
  pebbles: string[],
): RailDrag | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('kind' in value) ||
      !('id' in value) ||
      typeof value.id !== 'string'
    )
      return;
    if (value.kind === 'pebble' && pebbles.includes(value.id))
      return { kind: 'pebble', id: value.id };
    if (value.kind === 'section' && org.sections.some((s) => s.id === value.id))
      return { kind: 'section', id: value.id };
    if (
      value.kind === 'placement' &&
      org.sections.some((s) => s.items.some((i) => i.placementId === value.id))
    )
      return { kind: 'placement', id: value.id };
  } catch {
    return;
  }
  return;
}
