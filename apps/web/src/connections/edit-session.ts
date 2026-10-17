import type { Permission, ToolPolicy } from './model';
import { policyKey } from './model';

export type PolicyEdit =
  | { kind: 'empty'; draft: ToolPolicy }
  | { kind: 'ready'; base: Permission; remote: Permission; draft: ToolPolicy; conflict: boolean };
export type PolicyEvent =
  | { type: 'receive'; value: Permission }
  | { type: 'change'; value: ToolPolicy }
  | { type: 'saved'; value: Permission; submitted: ToolPolicy }
  | { type: 'discard' }
  | { type: 'keep' };

export const emptyPolicyEdit: PolicyEdit = { kind: 'empty', draft: { kind: 'native' } };
export function policyDirty(edit: PolicyEdit) {
  return (
    edit.kind === 'ready' &&
    (edit.conflict || policyKey(edit.draft) !== policyKey(edit.base.policy))
  );
}
export function reducePolicyEdit(edit: PolicyEdit, event: PolicyEvent): PolicyEdit {
  if (event.type === 'receive') {
    const remote = event.value;
    if (
      edit.kind === 'empty' ||
      !policyDirty(edit) ||
      policyKey(edit.draft) === policyKey(remote.policy)
    )
      return { kind: 'ready', base: remote, remote, draft: remote.policy, conflict: false };
    const conflict = policyKey(edit.base.policy) !== policyKey(remote.policy);
    return { ...edit, base: conflict ? edit.base : remote, remote, conflict };
  }
  if (event.type === 'change') return { ...edit, draft: event.value };
  if (edit.kind === 'empty') return edit;
  if (event.type === 'saved')
    return {
      kind: 'ready',
      base: event.value,
      remote: event.value,
      draft: policyKey(edit.draft) === policyKey(event.submitted) ? event.value.policy : edit.draft,
      conflict: false,
    };
  return {
    ...edit,
    base: edit.remote,
    draft: event.type === 'discard' ? edit.remote.policy : edit.draft,
    conflict: false,
  };
}
