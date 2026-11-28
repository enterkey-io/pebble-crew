export type ModelProvider = {
  id: string;
  name: string;
  models: string[];
  /** Grouped rows only: the provider each model came from, sent back on selection. */
  modelRoutes?: Map<string, string>;
};
export type ModelGroup = 'ollama-cloud' | 'ollama-local';

/**
 * Optional owner rules, read by the bridge from `model-groups.json` in the owner's
 * private bot-web data folder and returned with `chat.model.options` as `model_groups`.
 * Nothing here ships with the app; without the file the picker uses generic grouping only.
 *
 * {
 *   "schema": 1,
 *   "merge": [{ "canonical": "alpha:latest", "provider": "olares-ollama-cloud",
 *               "group": "ollama-cloud", "spellings": ["alpha", "alpha:latest", "org/alpha"] }],
 *   "hide": { "ollama-local": ["beta:latest"] },
 *   "prefer": { "gamma:7b": "olares-ollama-local" }
 * }
 *
 * - merge: spellings (case-insensitive) are one model listed under `group`. When
 *   `provider` offers `canonical`, only that entry is kept. If the current model is one
 *   of the spellings, the picker marks `group` as the current row.
 * - hide: models (case-insensitive) left out when offered by a provider in that group.
 * - prefer: when several providers in a group offer this exact model, use this provider
 *   (id without `custom:`) instead of the first one.
 */
export type ModelGroupRules = {
  merge: { canonical: string; provider: string; group: ModelGroup; spellings: string[] }[];
  hide: Partial<Record<ModelGroup, string[]>>;
  prefer: Record<string, string>;
};
export type ModelCatalog = {
  model: string;
  provider: string;
  providers: ModelProvider[];
  rules?: ModelGroupRules;
};

const groupNames: Record<ModelGroup, string> = {
  'ollama-cloud': 'Ollama Cloud',
  'ollama-local': 'Ollama Local',
};
const isGroup = (value: unknown): value is ModelGroup =>
  value === 'ollama-cloud' || value === 'ollama-local';
const strings = (value: unknown, limit: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= limit &&
  value.every((item) => typeof item === 'string' && item.length <= 250);

/** Accept bridge-supplied rules only in their exact shape; anything else means none. */
export function decodeModelGroupRules(value: unknown): ModelGroupRules | undefined {
  const data = value as Partial<Record<keyof ModelGroupRules, unknown>> | null;
  if (!data || typeof data !== 'object') return undefined;
  const { merge = [], hide = {}, prefer = {} } = data;
  if (
    !Array.isArray(merge) ||
    merge.length > 50 ||
    !merge.every(
      (item) =>
        item &&
        typeof item.canonical === 'string' &&
        typeof item.provider === 'string' &&
        isGroup(item.group) &&
        strings(item.spellings, 50),
    ) ||
    !hide ||
    typeof hide !== 'object' ||
    !Object.entries(hide).every(([group, models]) => isGroup(group) && strings(models, 500)) ||
    !prefer ||
    typeof prefer !== 'object' ||
    Object.keys(prefer).length > 500 ||
    !Object.values(prefer).every((provider) => typeof provider === 'string')
  )
    return undefined;
  return {
    merge: (merge as ModelGroupRules['merge']).map((item) => ({
      ...item,
      spellings: item.spellings.map((spelling) => spelling.toLowerCase()),
    })),
    hide: Object.fromEntries(
      Object.entries(hide as Record<string, string[]>).map(([group, models]) => [
        group,
        models.map((model) => model.toLowerCase()),
      ]),
    ),
    prefer: prefer as Record<string, string>,
  };
}

const bareId = (providerId: string) => providerId.replace(/^custom:/, '');

/**
 * Ollama and Olares providers belong to one family. An id ending in `-cloud` or `:cloud`
 * is Cloud; every other family member is Local. A `custom:` prefix is ignored.
 */
export function ollamaGroup(providerId: string): ModelGroup | undefined {
  const id = bareId(providerId).toLowerCase();
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
 * in the same group appears once; the first provider in Hermes's order keeps the route
 * unless owner rules prefer another. Selecting a grouped model sends the provider it
 * came from (`modelRoutes`).
 */
export function groupOllamaProviders(catalog: ModelCatalog): ModelCatalog {
  const rules = catalog.rules;
  const merges = rules?.merge ?? [];
  const mergeOf = (model: string) =>
    merges.find((item) => item.spellings.includes(model.toLowerCase()));
  const canonicalOffered = new Set(
    merges
      .filter((item) =>
        catalog.providers.some(
          (provider) =>
            ollamaGroup(provider.id) &&
            bareId(provider.id) === item.provider &&
            provider.models.includes(item.canonical),
        ),
      )
      .map((item) => item.canonical),
  );
  const groups = new Map<ModelGroup, ModelProvider & { modelRoutes: Map<string, string> }>();
  const providers: ModelProvider[] = [];
  for (const provider of catalog.providers) {
    const category = ollamaGroup(provider.id);
    if (!category) {
      providers.push(provider);
      continue;
    }
    for (const model of provider.models) {
      const key = model.toLowerCase();
      if (rules?.hide[category]?.includes(key)) continue;
      const merge = mergeOf(model);
      if (
        merge &&
        canonicalOffered.has(merge.canonical) &&
        (bareId(provider.id) !== merge.provider || key !== merge.canonical.toLowerCase())
      )
        continue;
      const group = merge?.group ?? category;
      let row = groups.get(group);
      if (!row) {
        row = { id: group, name: groupNames[group], models: [], modelRoutes: new Map() };
        groups.set(group, row);
        providers.push(row);
      }
      if (!row.modelRoutes.has(model)) {
        row.models.push(model);
        row.modelRoutes.set(model, provider.id);
      } else if (rules?.prefer[model] === bareId(provider.id)) {
        row.modelRoutes.set(model, provider.id);
      }
    }
  }
  const category = ollamaGroup(catalog.provider);
  const current = category && (mergeOf(catalog.model)?.group ?? category);
  return {
    model: catalog.model,
    provider: current && groups.has(current) ? current : catalog.provider,
    providers,
  };
}

/** The provider id to send when `model` is chosen from `provider`'s row. */
export function selectionProvider(provider: ModelProvider, model: string): string {
  return provider.modelRoutes?.get(model) ?? provider.id;
}
