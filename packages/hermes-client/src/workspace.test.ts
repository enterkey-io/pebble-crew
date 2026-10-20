import { describe, expect, it } from 'vitest';
import { decodeWorkspaceSnapshot as workspaceState } from './workspace';

it('accepts native Unicode codepoint limits for previews and role fields', () => {
  const snapshot = workspaceFixture();
  const bot = snapshot.bots[0]!;
  Object.assign(bot, { preview: 'a'.repeat(499) + '😀' });
  bot.role.title = '😀'.repeat(1000);
  expect(workspaceState(snapshot).bots[0]!.preview).toHaveLength(501);
  bot.role.title += 'x';
  expect(() => workspaceState(snapshot)).toThrow();
});

export function workspaceFixture() {
  return {
    id: 'synthetic-workspace',
    revision: 2,
    initialized: true,
    orchestrator: 'default',
    teams: [{ id: 'research', name: 'Research' }],
    bots: [
      {
        id: 'synthetic-incarnation',
        profile: 'default',
        handle: 'hermes',
        name: 'Hermes',
        description: '',
        managed: true,
        enrolled: true,
        canonical: true,
        manager: null,
        team: 'research',
        appearance: { kind: 'shape', shape: 'pebble', color: 'iris' },
        role: {
          title: '',
          description: '',
          responsibilities: '',
          boundaries: '',
          expectedOutputs: '',
        },
      },
    ],
  };
}

describe('workspace boundary', () => {
  it('accepts the native required shape and additive metadata without adding omitted fields', () => {
    const value = { ...workspaceFixture(), schema: 1, future: { enabled: true } };
    const parsed = workspaceState(value);
    expect(parsed.bots[0]).not.toHaveProperty('cursor_type');
    expect(parsed.bots[0]?.team).toBe('research');
    expect(parsed.bots[0]?.role.expectedOutputs).toBe('');
  });

  it.each([
    [
      'missing workspace identity',
      (v: ReturnType<typeof workspaceFixture>) => Reflect.deleteProperty(v, 'id'),
    ],
    [
      'missing bot identity',
      (v: ReturnType<typeof workspaceFixture>) => Reflect.deleteProperty(v.bots[0]!, 'id'),
    ],
    [
      'array appearance',
      (v: ReturnType<typeof workspaceFixture>) => Reflect.set(v.bots[0]!, 'appearance', []),
    ],
    [
      'string appearance',
      (v: ReturnType<typeof workspaceFixture>) => Reflect.set(v.bots[0]!, 'appearance', 'shape'),
    ],
    [
      'unknown shape',
      (v: ReturnType<typeof workspaceFixture>) =>
        Reflect.set(v.bots[0]!.appearance, 'shape', 'cube'),
    ],
    [
      'invalid role',
      (v: ReturnType<typeof workspaceFixture>) => Reflect.set(v.bots[0]!, 'role', 'Research'),
    ],
    [
      'missing role detail',
      (v: ReturnType<typeof workspaceFixture>) =>
        Reflect.deleteProperty(v.bots[0]!.role, 'boundaries'),
    ],
    [
      'numeric manager',
      (v: ReturnType<typeof workspaceFixture>) => Reflect.set(v.bots[0]!, 'manager', 42),
    ],
    [
      'invalid team',
      (v: ReturnType<typeof workspaceFixture>) => Reflect.set(v.bots[0]!, 'team', {}),
    ],
    [
      'invalid optional flag',
      (v: ReturnType<typeof workspaceFixture>) => Reflect.set(v.bots[0]!, 'pinned', 'yes'),
    ],
    [
      'invalid optional cursor',
      (v: ReturnType<typeof workspaceFixture>) => Reflect.set(v.bots[0]!, 'cursor', -1),
    ],
    [
      'invalid model grant',
      (v: ReturnType<typeof workspaceFixture>) =>
        Reflect.set(v, 'model_grant', { supported: true }),
    ],
    [
      'invalid team entry',
      (v: ReturnType<typeof workspaceFixture>) =>
        Reflect.set(v, 'teams', [{ id: 3, name: 'Research' }]),
    ],
  ])('rejects %s before replacing a valid snapshot', (_label, mutate) => {
    const value = workspaceFixture();
    let accepted = workspaceState(value);
    const malformed = structuredClone(value);
    mutate(malformed);
    expect(() => {
      accepted = workspaceState(malformed);
    }).toThrow();
    expect(accepted).toEqual(value);
  });
});

describe('supported workspace variants', () => {
  it('accepts summary clocks and null model availability without inventing defaults', () => {
    const minimal = workspaceFixture();
    const older = workspaceState({ ...minimal, model_grant: null });
    expect(older.model_grant).toBeNull();
    expect(older.bots[0]).not.toHaveProperty('available');
    const current = workspaceState({
      ...minimal,
      model_grant: {
        source: 'default',
        provider: 'custom:local',
        model: 'synthetic',
        supported: true,
        auth_kind: 'selected_custom_provider',
        fingerprint: 'f'.repeat(64),
        future: 'ignored',
      },
      bots: minimal.bots.map((bot) => ({
        ...bot,
        available: true,
        hidden: false,
        pinned: true,
        pin_configured: true,
        preview: 'Saved',
        cursor: 9,
        cursor_type: 'row',
        conversation_id: 'bot-chat-1',
        read_key: 'bot:incarnation:row:bot-chat-1',
        unread: true,
        native_incarnation: 'a'.repeat(64),
        future: { accepted: true },
      })),
    });
    expect(current.bots[0]).toMatchObject({
      cursor: 9,
      cursor_type: 'row',
      conversation_id: 'bot-chat-1',
      unread: true,
    });
    expect(current.model_grant?.model).toBe('synthetic');
  });
  it('rejects duplicate identities and oversized optional metadata', () => {
    const value = workspaceFixture();
    expect(() => workspaceState({ ...value, bots: [...value.bots, ...value.bots] })).toThrow();
    expect(() =>
      workspaceState({
        ...value,
        bots: value.bots.map((bot) => ({ ...bot, preview: 'x'.repeat(501) })),
      }),
    ).toThrow();
    expect(() =>
      workspaceState({
        ...value,
        bots: value.bots.map((bot) => ({ ...bot, cursor_type: 'sequence' })),
      }),
    ).toThrow();
    expect(() => workspaceState({ ...value, revision: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });
});
