export type RailItem = { kind: 'pebble' | 'crew'; id: string };
export type Placement = { kind: 'section' | 'crew'; id: string };
export type Section = { id: string; name: string; collapsed: boolean; items: RailItem[] };
export type Crew = {
  id: string;
  name: string;
  purpose: string;
  managerId: string | null;
  collapsed: boolean;
  members: string[];
};
export type Organization = { sections: Section[]; crews: Crew[] };
export type RailDropZone =
  { kind: 'section'; id: string } | { kind: 'item'; item: RailItem; placement: Placement };
export type RailDrop = {
  target: Placement;
  beforeId?: string | undefined;
  edge: 'before' | 'after' | 'inside';
};
export type OrganizationEditor =
  | { kind: 'new-section'; item?: RailItem }
  | { kind: 'edit-section'; id: string }
  | { kind: 'new-crew'; pebbleId?: string }
  | { kind: 'new-group-chat' }
  | { kind: 'edit-crew'; id: string };

export const SYSTEM_SECTIONS = { pebbles: 'Pebbles' } as const;
export function sectionChoiceLabel(section: Pick<Section, 'id' | 'name'>) {
  return section.id === 'pebbles' ? 'None' : section.name;
}
export function isSystemSection(id: string) {
  return id === 'pebbles';
}
export function sectionAccepts(id: string, kind: RailItem['kind']) {
  return !!id && (kind === 'crew' || kind === 'pebble');
}

function insertBefore<T>(items: T[], item: T, before: (value: T) => boolean) {
  const index = items.findIndex(before);
  const next = [...items];
  next.splice(index < 0 ? items.length : index, 0, item);
  return next;
}

/** Standalone references and Crew membership are independent. */
export function placePebble(
  org: Organization,
  id: string,
  target: Placement,
  beforeId?: string,
): Organization {
  if (beforeId === id) return org;
  if (target.kind === 'crew') {
    const crew = org.crews.find((c) => c.id === target.id);
    if (!crew) return org;
    return {
      ...org,
      crews: org.crews.map((c) =>
        c.id === crew.id
          ? {
              ...c,
              members: insertBefore(
                c.members.filter((m) => m !== id),
                id,
                (m) => m === beforeId,
              ),
            }
          : {
              ...c,
              members: c.members.filter((m) => m !== id),
              managerId: c.managerId === id ? null : c.managerId,
            },
      ),
      sections: org.sections.map((section) => ({
        ...section,
        items: org.crews.some((c) => c.members.includes(id))
          ? section.items
          : section.items.filter((i) => i.kind !== 'pebble' || i.id !== id),
      })),
    };
  }
  if (!org.sections.some((s) => s.id === target.id)) return org;
  if (!hasShortcut(org, id))
    org = {
      ...org,
      crews: org.crews.map((c) => ({
        ...c,
        members: c.members.filter((m) => m !== id),
        managerId: c.managerId === id ? null : c.managerId,
      })),
    };
  return {
    ...org,
    sections: org.sections.map((s) => {
      const items = s.items.filter((item) => item.kind !== 'pebble' || item.id !== id);
      return {
        ...s,
        items:
          s.id === target.id
            ? insertBefore(items, { kind: 'pebble', id }, (item) => item.id === beforeId)
            : items,
      };
    }),
  };
}

export function hasShortcut(org: Organization, id: string) {
  return org.sections.some((s) => s.items.some((i) => i.kind === 'pebble' && i.id === id));
}
export function addShortcut(org: Organization, id: string): Organization {
  if (hasShortcut(org, id)) return org;
  return {
    ...org,
    sections: org.sections.map((s) =>
      s.id === 'pebbles' ? { ...s, items: [{ kind: 'pebble', id }, ...s.items] } : s,
    ),
  };
}
export function removeShortcut(org: Organization, id: string): Organization {
  if (!org.crews.some((c) => c.members.includes(id))) return org;
  return {
    ...org,
    sections: org.sections.map((s) => ({
      ...s,
      items: s.items.filter((i) => i.kind !== 'pebble' || i.id !== id),
    })),
  };
}
export function crewMembers(crew: Crew): string[] {
  return crew.managerId
    ? [crew.managerId, ...crew.members.filter((id) => id !== crew.managerId)]
    : crew.members;
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

/** Resolve a whole sidebar entity before allowing a nested DOM drop target to consume it. */
export function railDropTarget(
  org: Organization,
  dragged: RailDrag['kind'],
  zone: RailDropZone,
  after: boolean,
): RailDrop | undefined {
  if (dragged === 'section') {
    if (zone.kind !== 'section' || zone.id === 'pebbles') return undefined;
    const index = org.sections.findIndex((section) => section.id === zone.id);
    return {
      target: zone,
      beforeId: after ? org.sections[index + 1]?.id : zone.id,
      edge: after ? 'after' : 'before',
    };
  }
  if (zone.kind === 'section')
    return sectionAccepts(zone.id, dragged) ? { target: zone, edge: 'inside' } : undefined;
  if (dragged === 'pebble' && zone.item.kind === 'crew')
    return { target: { kind: 'crew', id: zone.item.id }, edge: 'inside' };
  if (
    (dragged === 'crew' && zone.placement.kind === 'crew') ||
    (zone.placement.kind === 'section' && !sectionAccepts(zone.placement.id, dragged))
  )
    return undefined;
  const siblings =
    zone.placement.kind === 'crew'
      ? org.crews.find((c) => c.id === zone.placement.id)?.members
      : org.sections.find((s) => s.id === zone.placement.id)?.items.map((item) => item.id);
  const index = siblings?.indexOf(zone.item.id) ?? -1;
  return {
    target: zone.placement,
    beforeId: after ? siblings?.[index + 1] : zone.item.id,
    edge: after ? 'after' : 'before',
  };
}

/** Membership edits preserve independent shortcuts and keep every agent reachable. */
export function setCrewMembers(org: Organization, id: string, members: string[]): Organization {
  const crew = org.crews.find((c) => c.id === id);
  if (!crew) return org;
  const newlyJoined = members.filter((m) => !crew.members.includes(m));
  let next = {
    ...org,
    crews: org.crews.map((c) =>
      c.id === id
        ? {
            ...c,
            members,
            managerId: c.managerId && members.includes(c.managerId) ? c.managerId : null,
          }
        : {
            ...c,
            members: c.members.filter((m) => !members.includes(m)),
            managerId: c.managerId && members.includes(c.managerId) ? null : c.managerId,
          },
    ),
    sections: org.sections.map((s) => ({
      ...s,
      items: s.items.filter((i) => i.kind !== 'pebble' || !newlyJoined.includes(i.id)),
    })),
  };
  for (const previous of crew.members) {
    if (
      !members.includes(previous) &&
      !next.crews.some((c) => c.members.includes(previous)) &&
      !hasShortcut(next, previous)
    )
      next = addShortcut(next, previous);
  }
  return next;
}

export function placementOf(org: Organization, id: string): Placement | undefined {
  const section = org.sections.find((s) =>
    s.items.some((item) => item.kind === 'pebble' && item.id === id),
  );
  if (section) return { kind: 'section', id: section.id };
  const crew = org.crews.find((c) => c.members.includes(id));
  return crew ? { kind: 'crew', id: crew.id } : undefined;
}

export function reorderSection(org: Organization, id: string, beforeId?: string): Organization {
  const section = org.sections.find((s) => s.id === id);
  if (
    !section ||
    id === 'pebbles' ||
    beforeId === 'pebbles' ||
    id === beforeId ||
    (beforeId !== undefined && !org.sections.some((s) => s.id === beforeId))
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
  placement?: Placement,
) {
  const crew =
    item.kind === 'pebble' && placement?.kind === 'crew'
      ? org.crews.find((c) => c.id === placement.id)
      : undefined;
  const items: RailItem[] = crew
    ? crew.members.map((id) => ({ kind: 'pebble', id }))
    : (org.sections.find((s) => s.items.some((i) => i.kind === item.kind && i.id === item.id))
        ?.items ?? []);
  const visible = items.filter((i) =>
    crew
      ? i.id !== crew.managerId
      : i.kind !== 'pebble' ||
        !pinnedIds.includes(i.id) ||
        org.crews.some((c) => c.members.includes(i.id)),
  );
  const index = visible.findIndex((i) => i.kind === item.kind && i.id === item.id);
  return index >= 0 ? visible[index + direction] : undefined;
}
export function nudgeItem(
  org: Organization,
  item: RailItem,
  direction: -1 | 1,
  pinnedIds: readonly string[] = [],
  placement?: Placement,
): Organization {
  const next = neighbor(org, item, direction, pinnedIds, placement);
  if (!next) return org;
  const crew =
    item.kind === 'pebble' && placement?.kind === 'crew'
      ? org.crews.find((c) => c.id === placement.id)
      : undefined;
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

export type RailDrag = (RailItem & { placement?: Placement }) | { kind: 'section'; id: string };
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
  if (kind === 'pebble' && pebbleIds.includes(id)) {
    if ('placement' in data) {
      const placement = data.placement;
      if (
        !placement ||
        typeof placement !== 'object' ||
        !('kind' in placement) ||
        !('id' in placement) ||
        typeof placement.id !== 'string'
      )
        return undefined;
      if (
        placement.kind === 'crew' &&
        org.crews.some((c) => c.id === placement.id && c.members.includes(id))
      )
        return { kind, id, placement: { kind: 'crew', id: placement.id } };
      if (
        placement.kind === 'section' &&
        org.sections.some(
          (s) => s.id === placement.id && s.items.some((i) => i.kind === 'pebble' && i.id === id),
        )
      )
        return { kind, id, placement: { kind: 'section', id: placement.id } };
      return undefined;
    }
    return { kind, id };
  }
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
      managerId:
        'managerId' in c && typeof c.managerId === 'string' && c.members.includes(c.managerId)
          ? c.managerId
          : null,
      members: c.members,
    };
  });
  // Older response fixtures/clients migrate into one unnamed root. New saves carry schema 2.
  const roots = sections.filter((s) => isSystemSection(s.id) || s.id === 'crews');
  const rootItems = roots.flatMap((s) => s.items);
  const root = { id: 'pebbles', name: 'Pebbles', collapsed: false, items: rootItems };
  return {
    revision: Number(value.revision),
    sections: [root, ...sections.filter((s) => !roots.includes(s))],
    crews,
  };
}

export function removeCrew(org: Organization, id: string): Organization {
  const crew = org.crews.find((c) => c.id === id);
  if (!crew) return org;
  let next = {
    ...org,
    crews: org.crews.filter((c) => c.id !== id),
    sections: org.sections.map((s) => ({
      ...s,
      items: s.items.filter((i) => i.kind !== 'crew' || i.id !== id),
    })),
  };
  for (const member of crew.members)
    if (!next.crews.some((c) => c.members.includes(member)) && !hasShortcut(next, member))
      next = addShortcut(next, member);
  return next;
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
