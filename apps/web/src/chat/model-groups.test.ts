import { describe, expect, it } from 'vitest';
import { groupOllamaProviders, selectionProvider, type ModelCatalog } from './model-groups';

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
