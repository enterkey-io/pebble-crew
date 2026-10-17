export type RailItem = { kind: 'pebble' | 'crew'; id: string };
export type Placement = { kind: 'section' | 'crew'; id: string };
export type Section = { id: string; name: string; collapsed: boolean; items: RailItem[] };
export type Crew = {
  id: string;
  name: string;
  purpose: string;
  collapsed: boolean;
  members: string[];
};
export type Organization = { sections: Section[]; crews: Crew[] };
export type OrganizationEditor =
  | { kind: 'new-section' }
  | { kind: 'edit-section'; id: string }
  | { kind: 'new-crew' }
  | { kind: 'edit-crew'; id: string };

export const SYSTEM_SECTIONS = { pebbles: 'Pebbles', crews: 'Crews' } as const;
export function sectionChoiceLabel(section: Pick<Section, 'id' | 'name'>) {
  return section.id === 'pebbles' ? 'None' : section.name;
}
export function isSystemSection(id: string) {
  return id === 'pebbles' || id === 'crews';
}
export function sectionAccepts(id: string, kind: RailItem['kind']) {
  return id === 'crews' ? kind === 'crew' : id === 'pebbles' ? kind === 'pebble' : true;
}

function insertBefore<T>(items: T[], item: T, before: (value: T) => boolean) {
  const index = items.findIndex(before);
  const next = [...items];
  next.splice(index < 0 ? items.length : index, 0, item);
  return next;
}

export function placePebble(
  org: Organization,
  id: string,
  target: Placement,
  beforeId?: string,
): Organization {
  const exists =
    target.kind === 'section'
      ? org.sections.some((s) => s.id === target.id && sectionAccepts(s.id, 'pebble'))
      : org.crews.some((c) => c.id === target.id);
  if (!exists || beforeId === id) return org;
  return {
    sections: org.sections.map((s) => {
      const items = s.items.filter((item) => item.kind !== 'pebble' || item.id !== id);
      return {
        ...s,
        items:
          target.kind === 'section' && s.id === target.id
            ? insertBefore(items, { kind: 'pebble', id }, (item) => item.id === beforeId)
            : items,
      };
    }),
    crews: org.crews.map((c) => {
      const members = c.members.filter((member) => member !== id);
      return {
        ...c,
        members:
          target.kind === 'crew' && c.id === target.id
            ? insertBefore(members, id, (member) => member === beforeId)
            : members,
      };
    }),
  };
}

export function placeCrew(
  org: Organization,
  id: string,
  section: string,
  beforeId?: string,
): Organization {
  if (
    !sectionAccepts(section, 'crew') ||
    !org.sections.some((s) => s.id === section) ||
    beforeId === id
  )
    return org;
  return {
    ...org,
    sections: org.sections.map((s) => {
      const items = s.items.filter((item) => item.kind !== 'crew' || item.id !== id);
      return {
        ...s,
        items:
          s.id === section
            ? insertBefore(items, { kind: 'crew', id }, (item) => item.id === beforeId)
            : items,
      };
    }),
  };
}

export function placementOf(org: Organization, id: string): Placement | undefined {
  const section = org.sections.find((s) =>
    s.items.some((item) => item.kind === 'pebble' && item.id === id),
  );
  if (section) return { kind: 'section', id: section.id };
  const crew = org.crews.find((c) => c.members.includes(id));
  return crew ? { kind: 'crew', id: crew.id } : undefined;
}

export function reorderSection(org: Organization, id: string, beforeId: string): Organization {
  const section = org.sections.find((s) => s.id === id);
  if (
    !section ||
    id === 'pebbles' ||
    beforeId === 'pebbles' ||
    id === beforeId ||
    !org.sections.some((s) => s.id === beforeId)
  )
    return org;
  return {
    ...org,
    sections: insertBefore(
      org.sections.filter((s) => s.id !== id),
      section,
      (s) => s.id === beforeId,
    ),
  };
}

export function nudgeSection(org: Organization, id: string, direction: -1 | 1): Organization {
  const movable = org.sections.filter((s) => s.id !== 'pebbles');
  const index = movable.findIndex((s) => s.id === id),
    next = index + direction;
  if (index < 0 || next < 0 || next >= movable.length) return org;
  const sections = [...movable];
  [sections[index], sections[next]] = [sections[next]!, sections[index]!];
  return { ...org, sections: [...org.sections.filter((s) => s.id === 'pebbles'), ...sections] };
}

function neighbor(
  org: Organization,
  item: RailItem,
  direction: -1 | 1,
  pinnedIds: readonly string[],
) {
  const crew =
    item.kind === 'pebble' ? org.crews.find((c) => c.members.includes(item.id)) : undefined;
  const items: RailItem[] = crew
    ? crew.members.map((id) => ({ kind: 'pebble', id }))
    : (org.sections.find((s) => s.items.some((i) => i.kind === item.kind && i.id === item.id))
        ?.items ?? []);
  const visible = items.filter((i) => i.kind !== 'pebble' || !pinnedIds.includes(i.id));
  const index = visible.findIndex((i) => i.kind === item.kind && i.id === item.id);
  return index >= 0 ? visible[index + direction] : undefined;
}
export function nudgeItem(
  org: Organization,
  item: RailItem,
  direction: -1 | 1,
  pinnedIds: readonly string[] = [],
): Organization {
  const next = neighbor(org, item, direction, pinnedIds);
  if (!next) return org;
  const crew =
    item.kind === 'pebble' ? org.crews.find((c) => c.members.includes(item.id)) : undefined;
  if (crew) {
    const members = [...crew.members],
      a = members.indexOf(item.id),
      b = members.indexOf(next.id);
    [members[a], members[b]] = [members[b]!, members[a]!];
    return { ...org, crews: org.crews.map((c) => (c.id === crew.id ? { ...c, members } : c)) };
  }
  return {
    ...org,
    sections: org.sections.map((s) => {
      const a = s.items.findIndex((i) => i.kind === item.kind && i.id === item.id);
      if (a < 0) return s;
      const b = s.items.findIndex((i) => i.kind === next.kind && i.id === next.id),
        items = [...s.items];
      [items[a], items[b]] = [items[b]!, items[a]!];
      return { ...s, items };
    }),
  };
}
export function canNudgeItem(
  org: Organization,
  item: RailItem,
  direction: -1 | 1,
  pinnedIds: readonly string[] = [],
) {
  return neighbor(org, item, direction, pinnedIds) !== undefined;
}

export type RailDrag = RailItem | { kind: 'section'; id: string };
export function readRailDrag(
  value: string,
  org: Organization,
  pebbleIds: string[],
): RailDrag | undefined {
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (
    !data ||
    typeof data !== 'object' ||
    !('id' in data) ||
    !('kind' in data) ||
    typeof data.id !== 'string'
  )
    return undefined;
  const { id, kind } = data;
  if (kind === 'pebble' && pebbleIds.includes(id)) return { kind, id };
  if (kind === 'crew' && org.crews.some((c) => c.id === id)) return { kind, id };
  if (kind === 'section' && org.sections.some((s) => s.id === id)) return { kind, id };
  return undefined;
}

export type OrganizationState = Organization & { revision: number };
/** Validate the plugin boundary before the UI operates on placement identities. */
export function organizationState(value: unknown): OrganizationState {
  if (
    !value ||
    typeof value !== 'object' ||
    !('revision' in value) ||
    !Number.isSafeInteger(value.revision) ||
    !('sections' in value) ||
    !Array.isArray(value.sections) ||
    !value.sections.length ||
    value.sections.length > 100 ||
    !('crews' in value) ||
    !Array.isArray(value.crews) ||
    value.crews.length > 100
  )
    throw new Error('Invalid sidebar organization');
  const named = (v: unknown): v is { id: string; name: string; collapsed: boolean } =>
    !!v &&
    typeof v === 'object' &&
    'id' in v &&
    typeof v.id === 'string' &&
    'name' in v &&
    typeof v.name === 'string' &&
    'collapsed' in v &&
    typeof v.collapsed === 'boolean';
  const sections: Section[] = value.sections.map((s: unknown) => {
    if (!named(s) || !('items' in s) || !Array.isArray(s.items) || s.items.length > 1000)
      throw new Error('Invalid section');
    const items: RailItem[] = s.items.map((i: unknown) => {
      if (
        !i ||
        typeof i !== 'object' ||
        !('kind' in i) ||
        !['pebble', 'crew'].includes(String(i.kind)) ||
        !('id' in i) ||
        typeof i.id !== 'string'
      )
        throw new Error('Invalid placement');
      return { kind: i.kind === 'pebble' ? 'pebble' : 'crew', id: i.id };
    });
    return { id: s.id, name: s.name, collapsed: s.collapsed, items };
  });
  const crews: Crew[] = value.crews.map((c: unknown) => {
    if (
      !named(c) ||
      !('purpose' in c) ||
      typeof c.purpose !== 'string' ||
      !('members' in c) ||
      !Array.isArray(c.members) ||
      c.members.length > 1000 ||
      !c.members.every((i: unknown) => typeof i === 'string')
    )
      throw new Error('Invalid crew');
    return {
      id: c.id,
      name: c.name,
      collapsed: c.collapsed,
      purpose: c.purpose,
      members: c.members,
    };
  });
  return { revision: Number(value.revision), sections, crews };
}

export function removeCrew(org: Organization, id: string): Organization {
  const crew = org.crews.find((c) => c.id === id);
  if (!crew) return org;
  return {
    crews: org.crews.filter((c) => c.id !== id),
    sections: org.sections.map((s) => ({
      ...s,
      items: [
        ...s.items.filter((item) => item.kind !== 'crew' || item.id !== id),
        ...(s.id === org.sections.find((target) => sectionAccepts(target.id, 'pebble'))?.id
          ? crew.members.map((member) => ({ kind: 'pebble' as const, id: member }))
          : []),
      ],
    })),
  };
}
export function removeSection(org: Organization, id: string): Organization {
  if (isSystemSection(id) || org.sections.length < 2) return org;
  const section = org.sections.find((s) => s.id === id);
  if (!section) return org;
  return {
    ...org,
    sections: org.sections
      .filter((s) => s.id !== id)
      .map((s) => ({
        ...s,
        items: [
          ...s.items,
          ...section.items.filter(
            (item) =>
              org.sections.find(
                (target) => target.id !== id && sectionAccepts(target.id, item.kind),
              )?.id === s.id,
          ),
        ],
      })),
  };
}
