import { APPEARANCE_COLORS, ClientError, SHAPES } from '@hermes-client/core';
import { record } from './json';

function text(value: unknown, limit: number, blank = true): string {
  if (typeof value !== 'string' || [...value].length > limit || (!blank && !value.trim()))
    throw new ClientError('INVALID_RESPONSE');
  return value;
}
function identity(value: unknown): string {
  const result = text(value, 128, false);
  if (!/^[A-Za-z0-9_.:-]+$/.test(result)) throw new ClientError('INVALID_RESPONSE');
  return result;
}
function reference(value: unknown): string | null {
  return value === null ? null : identity(value);
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ClientError('INVALID_RESPONSE');
  return value;
}
function counter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ClientError('INVALID_RESPONSE');
  return value;
}
function member<T extends string>(value: unknown, values: readonly T[]): T {
  const result = values.find((item) => item === value);
  if (result === undefined) throw new ClientError('INVALID_RESPONSE');
  return result;
}
function optional<K extends string, T>(
  source: Record<string, unknown>,
  key: K,
  decode: (value: unknown) => T,
): Partial<Record<K, T>> {
  if (!(key in source)) return {};
  // The computed property is the validated key and its value is constructed by the decoder.
  return { [key]: decode(source[key]) } as Record<K, T>;
}
function list<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new ClientError('INVALID_RESPONSE');
  return value.map(decode);
}
function unique(values: string[]): void {
  if (new Set(values).size !== values.length) throw new ClientError('INVALID_RESPONSE');
}

export function decodeAppearance(value: unknown) {
  const data = record(value);
  return {
    kind: member(data.kind, ['shape', 'photo']),
    shape: member(data.shape, SHAPES),
    color: text(member(data.color, APPEARANCE_COLORS), 32),
  };
}
export type Appearance = ReturnType<typeof decodeAppearance>;

export function decodeRole(value: unknown) {
  const data = record(value);
  return {
    title: text(data.title, 1000),
    description: text(data.description, 1000),
    responsibilities: text(data.responsibilities, 1000),
    boundaries: text(data.boundaries, 1000),
    expectedOutputs: text(data.expectedOutputs, 1000),
  };
}
export type Role = ReturnType<typeof decodeRole>;

function decodeBot(value: unknown) {
  const data = record(value);
  return {
    id: identity(data.id),
    profile: identity(data.profile),
    handle: identity(data.handle),
    name: text(data.name, 1000, false),
    description: text(data.description, 16_000),
    managed: boolean(data.managed),
    enrolled: boolean(data.enrolled),
    canonical: boolean(data.canonical),
    manager: reference(data.manager),
    team: reference(data.team),
    appearance: decodeAppearance(data.appearance),
    role: decodeRole(data.role),
    ...optional(data, 'available', boolean),
    ...optional(data, 'hidden', boolean),
    ...optional(data, 'pinned', boolean),
    ...optional(data, 'pin_configured', boolean),
    ...optional(data, 'unread', boolean),
    ...optional(data, 'deleted', boolean),
    ...optional(data, 'preview', (v) => text(v, 500)),
    ...optional(data, 'cursor', counter),
    ...optional(data, 'cursor_type', (v) => member(v, ['row', 'count'])),
    ...optional(data, 'read_key', (v) => text(v, 1024, false)),
    ...optional(data, 'conversation_id', (v) => text(v, 128)),
    ...optional(data, 'native_incarnation', (v) => text(v, 128, false)),
    ...optional(data, 'welcome', (v) => member(v, ['submitting', 'accepted', 'uncertain'])),
  };
}
export type WorkspaceBot = ReturnType<typeof decodeBot>;

export function decodeModelGrant(value: unknown) {
  const data = record(value);
  return {
    source: text(data.source, 128, false),
    provider: text(data.provider, 1000),
    model: text(data.model, 1000),
    supported: boolean(data.supported),
    auth_kind: text(data.auth_kind, 128, false),
    fingerprint: text(data.fingerprint, 128, false),
  };
}
export type ModelGrant = ReturnType<typeof decodeModelGrant>;

export function decodeAgentCapabilities(value: unknown) {
  const data = record(value);
  const capability = (value: unknown) => {
    const item = record(value);
    return {
      name: text(item.name, 256, false),
      enabled: boolean(item.enabled),
      ...optional(item, 'label', (v) => text(v, 1000)),
      ...optional(item, 'description', (v) => text(v, 16_000)),
      ...optional(item, 'required', boolean),
    };
  };
  return { skills: list(data.skills, capability), toolsets: list(data.toolsets, capability) };
}
export type WorkspaceAgentCapabilities = ReturnType<typeof decodeAgentCapabilities>;

export function decodeWorkspaceSnapshot(value: unknown) {
  const data = record(value);
  const bots = list(data.bots, decodeBot);
  const teams = list(data.teams, (item) => {
    const team = record(item);
    return { id: identity(team.id), name: text(team.name, 80, false) };
  });
  unique(bots.map((bot) => bot.id));
  unique(bots.map((bot) => bot.profile));
  unique(teams.map((team) => team.id));
  return {
    id: identity(data.id),
    revision: counter(data.revision),
    initialized: boolean(data.initialized),
    orchestrator: reference(data.orchestrator),
    bots,
    teams,
    ...optional(data, 'welcome', (v) => member(v, ['submitting', 'accepted', 'uncertain'])),
    ...optional(data, 'model_grant', (v) => (v === null ? null : decodeModelGrant(v))),
  };
}
export type WorkspaceSnapshot = ReturnType<typeof decodeWorkspaceSnapshot>;
