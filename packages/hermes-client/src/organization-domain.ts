import { ClientError } from '@hermes-client/core';
import type { SessionClient } from './session-client';
import { record } from './json';

export type RailItem =
  | { kind: 'pebble'; id: string; placementId: string; shortcut: boolean }
  | { kind: 'group'; id: string; placementId: string; readKey: string };
export type Section = { id: string; name: string; collapsed: boolean; items: RailItem[] };
export type Organization = { sections: Section[] };
export type OrganizationState = Organization & { revision: number };

function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value || value.length > max)
    throw new ClientError('INVALID_RESPONSE');
  return value;
}
export function organizationState(value: unknown): OrganizationState {
  const data = record(value);
  if (
    data.schema !== 3 ||
    !Number.isSafeInteger(data.revision) ||
    Number(data.revision) < 0 ||
    !Array.isArray(data.sections) ||
    !data.sections.length ||
    data.sections.length > 100
  )
    throw new ClientError('INVALID_RESPONSE');
  const sectionIds = new Set<string>(),
    placementIds = new Set<string>();
  const sections: Section[] = data.sections.map((raw: unknown) => {
    const row = record(raw),
      id = text(row.id);
    if (
      sectionIds.has(id) ||
      typeof row.collapsed !== 'boolean' ||
      !Array.isArray(row.items) ||
      row.items.length > 5000
    )
      throw new ClientError('INVALID_RESPONSE');
    sectionIds.add(id);
    const items: RailItem[] = row.items.map((input: unknown) => {
      const item = record(input),
        placementId = text(item.placementId),
        target = text(item.id);
      if (placementIds.has(placementId)) throw new ClientError('INVALID_RESPONSE');
      placementIds.add(placementId);
      if (item.kind === 'pebble' && typeof item.shortcut === 'boolean')
        return { kind: 'pebble', id: target, placementId, shortcut: item.shortcut };
      if (item.kind === 'group') {
        const readKey = text(item.readKey, 512);
        if (readKey.startsWith(`room:${target}:`))
          return { kind: 'group', id: target, placementId, readKey };
      }
      throw new ClientError('INVALID_RESPONSE');
    });
    return { id, name: text(row.name, 60), collapsed: row.collapsed, items };
  });
  if (!sections.some((s) => s.id === 'pebbles' && s.name === 'Pebbles'))
    throw new ClientError('INVALID_RESPONSE');
  return { revision: Number(data.revision), sections };
}

export class OrganizationDomain {
  constructor(private readonly bridge: Pick<SessionClient, 'invoke'>) {}
  async read() {
    return organizationState(await this.bridge.invoke('organization.get', {}));
  }
  async save(value: Organization, revision: number, operationId: string) {
    return organizationState(
      await this.bridge.invoke('organization.save', {
        organization: { schema: 3, sections: value.sections },
        expected_revision: revision,
        operation_id: operationId,
      }),
    );
  }
}

export function retainPartialGroups(
  current: OrganizationState,
  incoming: OrganizationState,
): OrganizationState {
  const keys = new Set(
    incoming.sections.flatMap((s) =>
      s.items.flatMap((i) => (i.kind === 'group' ? [i.readKey] : [])),
    ),
  );
  const retained = current.sections.flatMap((s) =>
    s.items.filter((i) => i.kind === 'group' && !keys.has(i.readKey)),
  );
  return retained.length
    ? {
        ...incoming,
        sections: incoming.sections.map((s) =>
          s.id === 'pebbles' ? { ...s, items: [...s.items, ...retained] } : s,
        ),
      }
    : incoming;
}
