import { describe, expect, it } from 'vitest';
import {
  decodeModelGroupRules,
  groupOllamaProviders,
  selectionProvider,
  type ModelCatalog,
} from './model-groups';

const catalog = (provider: string, providers: ModelCatalog['providers']): ModelCatalog => ({
  model: 'alpha',
  provider,
  providers,
});

describe('Ollama model picker groups', () => {
  it('groups Ollama and Olares providers into Cloud and Local and passes others through', () => {
    const openai = { id: 'openai', name: 'OpenAI', models: ['gamma'] };
    const result = groupOllamaProviders(
      catalog('openai', [
        openai,
        { id: 'ollama-cloud', name: 'A', models: ['alpha'] },
        { id: 'custom:olares-ollama-cloud', name: 'B', models: ['org/alpha'] },
        { id: 'custom:ollama:cloud', name: 'C', models: ['delta'] },
        { id: 'ollama', name: 'D', models: ['beta:latest'] },
        { id: 'ollama-local', name: 'E', models: ['epsilon'] },
        { id: 'custom:olares-local', name: 'F', models: ['zeta'] },
        { id: 'olares-ollama-local', name: 'G', models: ['eta'] },
        { id: 'olares-files', name: 'Olares files', models: ['theta'] },
      ]),
    );
    expect(result.providers.map(({ id, name, models }) => ({ id, name, models }))).toEqual([
      openai,
      { id: 'ollama-cloud', name: 'Ollama Cloud', models: ['alpha', 'org/alpha', 'delta'] },
      {
        id: 'ollama-local',
        name: 'Ollama Local',
        models: ['beta:latest', 'epsilon', 'zeta', 'eta'],
      },
      { id: 'olares-files', name: 'Olares files', models: ['theta'] },
    ]);
    expect(result.providers[0]).toBe(openai);
    expect(result.provider).toBe('openai');
  });

  it('selects a grouped model through the provider it came from', () => {
    const result = groupOllamaProviders(
      catalog('custom:olares-ollama-local', [
        { id: 'ollama', name: 'Ollama', models: ['alpha'] },
        { id: 'custom:olares-ollama-local', name: 'Olares', models: ['beta:latest'] },
      ]),
    );
    const local = result.providers.find((item) => item.id === 'ollama-local')!;
    expect(result.provider).toBe('ollama-local');
    expect(selectionProvider(local, 'alpha')).toBe('ollama');
    expect(selectionProvider(local, 'beta:latest')).toBe('custom:olares-ollama-local');
    expect(selectionProvider({ id: 'openai', name: 'OpenAI', models: ['gamma'] }, 'gamma')).toBe(
      'openai',
    );
  });

  it('shows a model offered twice in one group once, routed to the first provider', () => {
    const result = groupOllamaProviders(
      catalog('ollama-cloud', [
        { id: 'ollama-cloud', name: 'A', models: ['alpha', 'beta:latest'] },
        { id: 'olares-ollama-cloud', name: 'B', models: ['beta:latest', 'org/alpha'] },
      ]),
    );
    const cloud = result.providers.find((item) => item.id === 'ollama-cloud')!;
    expect(cloud.models).toEqual(['alpha', 'beta:latest', 'org/alpha']);
    expect(selectionProvider(cloud, 'beta:latest')).toBe('ollama-cloud');
    expect(selectionProvider(cloud, 'org/alpha')).toBe('olares-ollama-cloud');
  });
});

describe('owner model group rules', () => {
  const rules = decodeModelGroupRules({
    merge: [
      {
        canonical: 'alpha:latest',
        provider: 'olares-ollama-cloud',
        group: 'ollama-cloud',
        spellings: ['alpha', 'Alpha:Latest', 'org/alpha'],
      },
    ],
    hide: { 'ollama-local': ['Beta:Latest'] },
    prefer: { 'gamma:7b': 'olares-ollama-local' },
  })!;
  const rows = (result: ModelCatalog) =>
    result.providers.map((row) => [row.id, row.models, [...(row.modelRoutes ?? [])]]);

  it('merges spellings under their group and keeps only the canonical route when offered', () => {
    const providers = [
      { id: 'ollama', name: 'Ollama', models: ['alpha', 'delta'] },
      { id: 'custom:olares-ollama-cloud', name: 'Olares', models: ['org/alpha', 'alpha:latest'] },
    ];
    expect(rows(groupOllamaProviders({ ...catalog('openai', providers), rules }))).toEqual([
      ['ollama-local', ['delta'], [['delta', 'ollama']]],
      ['ollama-cloud', ['alpha:latest'], [['alpha:latest', 'custom:olares-ollama-cloud']]],
    ]);
    const withoutCanonical = [{ id: 'ollama', name: 'Ollama', models: ['alpha', 'org/alpha'] }];
    expect(rows(groupOllamaProviders({ ...catalog('openai', withoutCanonical), rules }))).toEqual([
      [
        'ollama-cloud',
        ['alpha', 'org/alpha'],
        [
          ['alpha', 'ollama'],
          ['org/alpha', 'ollama'],
        ],
      ],
    ]);
  });

  it('hides listed models only from the named group', () => {
    const providers = [
      { id: 'ollama-local', name: 'Local', models: ['beta:latest', 'delta'] },
      { id: 'ollama-cloud', name: 'Cloud', models: ['beta:latest'] },
    ];
    expect(rows(groupOllamaProviders({ ...catalog('openai', providers), rules }))).toEqual([
      ['ollama-local', ['delta'], [['delta', 'ollama-local']]],
      ['ollama-cloud', ['beta:latest'], [['beta:latest', 'ollama-cloud']]],
    ]);
  });

  it('routes a shared model to the preferred provider instead of the first', () => {
    const providers = [
      { id: 'ollama', name: 'Ollama', models: ['gamma:7b', 'delta'] },
      { id: 'custom:olares-ollama-local', name: 'Olares', models: ['gamma:7b', 'delta'] },
    ];
    const local = groupOllamaProviders({ ...catalog('openai', providers), rules }).providers[0]!;
    expect(selectionProvider(local, 'gamma:7b')).toBe('custom:olares-ollama-local');
    expect(selectionProvider(local, 'delta')).toBe('ollama');
  });

  it('marks the merged group current when the current model is a merged spelling', () => {
    const providers = [
      { id: 'ollama', name: 'Ollama', models: ['delta'] },
      { id: 'ollama-cloud', name: 'Cloud', models: ['org/alpha'] },
    ];
    const current = { model: 'ORG/alpha', provider: 'ollama', providers, rules };
    expect(groupOllamaProviders(current).provider).toBe('ollama-cloud');
    expect(
      groupOllamaProviders({ model: 'ORG/alpha', provider: 'ollama', providers }).provider,
    ).toBe('ollama-local');
  });

  it('ignores malformed rules so the picker stays generic', () => {
    for (const value of [
      undefined,
      null,
      'rules',
      { merge: [{ canonical: 'alpha', provider: 'x', group: 'elsewhere', spellings: [] }] },
      { hide: { 'ollama-local': 'beta:latest' } },
      { prefer: { alpha: 7 } },
    ])
      expect(decodeModelGroupRules(value)).toBeUndefined();
  });
});
