import type { Appearance, Role, WorkspaceBot } from '@hermes-client/protocol';

export type ProfileValues = {
  name: string;
  handle: string;
  appearance: Appearance;
  photo: string;
  role: Role;
  manager: string;
  team: string;
};
type Field = Exclude<keyof ProfileValues, 'role'> | `role.${keyof Role}`;
export type ProfileSession = {
  identity: string | null;
  revision: number;
  baseline: ProfileValues;
  draft: ProfileValues;
  conflicts: Field[];
  retired: boolean;
};
export const roleFields = [
  'title',
  'description',
  'responsibilities',
  'boundaries',
  'expectedOutputs',
] as const;
const fields = ['name', 'handle', 'appearance', 'photo', 'manager', 'team'] as const;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function emptyProfile(manager = ''): ProfileValues {
  return {
    name: '',
    handle: '',
    appearance: { kind: 'shape', shape: 'pebble', color: 'iris' },
    photo: '',
    role: { title: '', description: '', responsibilities: '', boundaries: '', expectedOutputs: '' },
    manager,
    team: '',
  };
}
export function profileValues(
  bot: WorkspaceBot,
  fallbackManager = '',
  fallbackDescription = false,
): ProfileValues {
  return {
    name: bot.name,
    handle: bot.handle,
    appearance: bot.appearance,
    photo: '',
    role: {
      ...bot.role,
      description: bot.role.description || (fallbackDescription ? bot.description : ''),
    },
    manager: bot.manager ?? fallbackManager,
    team: bot.team ?? '',
  };
}
export function profileSession(
  values: ProfileValues,
  identity: string | null = null,
  revision = 0,
): ProfileSession {
  return { identity, revision, baseline: values, draft: values, conflicts: [], retired: false };
}
export function mergeOwned<T>(baseline: T, draft: T, incoming: T) {
  return {
    value: equal(draft, baseline) ? incoming : draft,
    conflict: !equal(baseline, incoming) && !equal(draft, baseline) && !equal(draft, incoming),
  };
}
export function profileDirty(edit: ProfileSession) {
  return !equal(edit.draft, edit.baseline);
}
export function profileSection(field: Field) {
  return field.startsWith('role.') || field === 'manager' || field === 'team'
    ? 'role'
    : field === 'appearance' || field === 'photo'
      ? 'appearance'
      : field === 'handle'
        ? 'handle'
        : 'profile';
}
export type ProfileEvent =
  | { type: 'change'; patch: Partial<ProfileValues> }
  | { type: 'receive'; values: ProfileValues; identity: string; revision: number }
  | { type: 'saved'; submitted: ProfileValues; section: 'profile' | 'role' }
  | { type: 'resolve'; section: string; useSaved: boolean };

export function profileReducer(edit: ProfileSession, event: ProfileEvent): ProfileSession {
  if (event.type === 'change') return { ...edit, draft: { ...edit.draft, ...event.patch } };
  if (event.type === 'resolve') {
    const chosen = edit.conflicts.filter((field) => profileSection(field) === event.section);
    const draft = { ...edit.draft, role: { ...edit.draft.role } };
    if (event.useSaved) {
      for (const key of fields)
        if (chosen.includes(key)) Object.assign(draft, { [key]: edit.baseline[key] });
      for (const key of roleFields)
        if (chosen.includes(`role.${key}`)) draft.role[key] = edit.baseline.role[key];
      if (chosen.includes('appearance')) draft.photo = '';
    }
    return { ...edit, draft, conflicts: edit.conflicts.filter((field) => !chosen.includes(field)) };
  }
  if (event.type === 'saved') {
    const baseline = {
      ...edit.baseline,
      role: { ...event.submitted.role },
      manager: event.submitted.manager,
    };
    if (event.section === 'profile')
      Object.assign(baseline, event.submitted, { photo: '', team: edit.baseline.team });
    else baseline.team = event.submitted.team;
    return {
      ...edit,
      baseline,
      draft: {
        ...edit.draft,
        photo:
          event.section === 'profile' && edit.draft.photo === event.submitted.photo
            ? ''
            : edit.draft.photo,
      },
      conflicts: edit.conflicts.filter(
        (field) => event.section === 'role' && profileSection(field) !== 'role',
      ),
    };
  }
  if (event.revision < edit.revision) return edit;
  if (edit.identity && event.identity !== edit.identity) return { ...edit, retired: true };
  if (!edit.identity) return profileSession(event.values, event.identity, event.revision);
  const draft = { ...edit.draft, role: { ...edit.draft.role } };
  const conflicts = new Set(edit.conflicts);
  const incoming = event.values;
  function merge<K extends (typeof fields)[number]>(key: K) {
    const merged = mergeOwned(edit.baseline[key], edit.draft[key], incoming[key]);
    draft[key] = merged.value;
    if (merged.conflict) conflicts.add(key);
    if (equal(draft[key], incoming[key])) conflicts.delete(key);
  }
  fields.forEach(merge);
  for (const key of roleFields) {
    const merged = mergeOwned(
      edit.baseline.role[key],
      edit.draft.role[key],
      event.values.role[key],
    );
    draft.role[key] = merged.value;
    if (merged.conflict) conflicts.add(`role.${key}`);
    if (equal(draft.role[key], event.values.role[key])) conflicts.delete(`role.${key}`);
  }
  if (edit.draft.photo && !equal(edit.baseline.appearance, event.values.appearance))
    conflicts.add('appearance');
  return {
    ...edit,
    identity: event.identity,
    revision: event.revision,
    baseline: event.values,
    draft,
    conflicts: [...conflicts],
  };
}
