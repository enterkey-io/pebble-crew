import type { PlanDraft } from '@hermes-client/protocol';
import { mergeOwned } from '../profiles/edit-session';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export type Edit<T> = { baseline: T; draft: T; revision: number; conflicts: (keyof T)[] };
export function session<T>(value: T, revision: number): Edit<T> {
  return { baseline: value, draft: value, revision, conflicts: [] };
}
export function receive<T>(
  edit: Edit<T>,
  value: T,
  revision: number,
  fields: readonly (keyof T)[],
): Edit<T> {
  if (revision === edit.revision) return edit;
  const draft = { ...edit.draft };
  const conflicts: (keyof T)[] = [];
  for (const key of fields) {
    const merged = mergeOwned(edit.baseline[key], edit.draft[key], value[key]);
    draft[key] = merged.value;
    if (merged.conflict || (edit.conflicts.includes(key) && !same(edit.draft[key], value[key])))
      conflicts.push(key);
  }
  return { baseline: value, draft, revision, conflicts };
}
export function resolve<T>(edit: Edit<T>, useSaved: boolean): Edit<T> {
  const draft = { ...edit.draft };
  if (useSaved) for (const key of edit.conflicts) draft[key] = edit.baseline[key];
  return { ...edit, draft, conflicts: [] };
}
export const planFields = [
  'title',
  'outcome',
  'body',
  'status',
  'ownerId',
  'parentId',
  'crewIds',
  'boards',
] as const satisfies readonly (keyof PlanDraft)[];
export function descendants(
  plans: readonly { id: string; parentId: string | null }[],
  id: string | null,
) {
  const excluded = new Set(id ? [id] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const plan of plans)
      if (plan.parentId && excluded.has(plan.parentId) && !excluded.has(plan.id)) {
        excluded.add(plan.id);
        changed = true;
      }
  }
  return excluded;
}
