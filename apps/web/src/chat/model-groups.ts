export type ModelProvider = {
  id: string;
  name: string;
  models: string[];
  /** Grouped rows only: the provider each model came from, sent back on selection. */
  modelRoutes?: Map<string, string>;
};
export type ModelCatalog = { model: string; provider: string; providers: ModelProvider[] };

type Group = 'ollama-cloud' | 'ollama-local';
const groupNames: Record<Group, string> = {
  'ollama-cloud': 'Ollama Cloud',
  'ollama-local': 'Ollama Local',
};

/**
 * Ollama and Olares providers belong to one family. An id ending in `-cloud` or `:cloud`
 * is Cloud; every other family member is Local. A `custom:` prefix is ignored.
 */
export function ollamaGroup(providerId: string): Group | undefined {
  const id = providerId.replace(/^custom:/, '').toLowerCase();
  const parts = id.split(/[-:]/);
  const family =
    parts[0] === 'ollama' ||
    (parts[0] === 'olares' &&
      (parts.includes('ollama') || ['local', 'cloud'].includes(parts.slice(1).join('-'))));
  if (!family) return undefined;
  return /[-:]cloud$/.test(id) ? 'ollama-cloud' : 'ollama-local';
}

/**
 * Show Ollama/Olares providers as one "Ollama Cloud" row and one "Ollama Local" row.
 * Other providers keep their place and identity. A model offered by several providers
 * in the same group appears once; the first provider in Hermes's order keeps the route.
 * Selecting a grouped model sends the provider it came from (`modelRoutes`).
 */
export function groupOllamaProviders(catalog: ModelCatalog): ModelCatalog {
  const groups = new Map<Group, ModelProvider & { modelRoutes: Map<string, string> }>();
  const providers: ModelProvider[] = [];
  for (const provider of catalog.providers) {
    const group = ollamaGroup(provider.id);
    if (!group) {
      providers.push(provider);
      continue;
    }
    let row = groups.get(group);
    if (!row) {
      row = { id: group, name: groupNames[group], models: [], modelRoutes: new Map() };
      groups.set(group, row);
      providers.push(row);
    }
    for (const model of provider.models) {
      if (row.modelRoutes.has(model)) continue;
      row.models.push(model);
      row.modelRoutes.set(model, provider.id);
    }
  }
  const current = ollamaGroup(catalog.provider);
  return {
    ...catalog,
    provider: current && groups.has(current) ? current : catalog.provider,
    providers,
  };
}

/** The provider id to send when `model` is chosen from `provider`'s row. */
export function selectionProvider(provider: ModelProvider, model: string): string {
  return provider.modelRoutes?.get(model) ?? provider.id;
}
