import { mergeOwned } from './edit-session';
export type ToolChoices = { skills: string[]; toolsets: string[] };
export type ToolSession = {
  baseline: ToolChoices;
  draft: ToolChoices;
  conflict: boolean;
  initialized: boolean;
};
export const emptyTools: ToolSession = {
  baseline: { skills: [], toolsets: [] },
  draft: { skills: [], toolsets: [] },
  conflict: false,
  initialized: false,
};
export type ToolEvent =
  | { type: 'receive'; value: ToolChoices }
  | { type: 'change'; patch: Partial<ToolChoices> }
  | { type: 'saved'; submitted: ToolChoices }
  | { type: 'resolve'; useSaved: boolean };
export function toolsDirty(edit: ToolSession) {
  return JSON.stringify(edit.baseline) !== JSON.stringify(edit.draft);
}
export function toolReducer(edit: ToolSession, event: ToolEvent): ToolSession {
  if (event.type === 'change') return { ...edit, draft: { ...edit.draft, ...event.patch } };
  if (event.type === 'saved') return { ...edit, baseline: event.submitted, conflict: false };
  if (event.type === 'resolve')
    return { ...edit, draft: event.useSaved ? edit.baseline : edit.draft, conflict: false };
  if (!edit.initialized)
    return { baseline: event.value, draft: event.value, conflict: false, initialized: true };
  const merged = mergeOwned(edit.baseline, edit.draft, event.value);
  return {
    baseline: event.value,
    draft: merged.value,
    conflict:
      merged.conflict ||
      (edit.conflict && JSON.stringify(merged.value) !== JSON.stringify(event.value)),
    initialized: true,
  };
}
