import { useId, useRef, useState } from 'react';
import type { WorkspaceSnapshot } from '@hermes-client/protocol';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { MentionSuggestions, useMentionSuggestions } from '../chat/MentionSuggestions';

export function TaskComment({
  value,
  onChange,
  workspace,
}: {
  value: string;
  onChange: (value: string) => void;
  workspace: WorkspaceSnapshot;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const [caret, setCaret] = useState(0);
  const suggestions = useMentionSuggestions({
    value,
    caret,
    bots: workspace.bots,
    onChoose(value, position) {
      onChange(value);
      setCaret(position);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(position, position);
      });
    },
  });
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Comment</Label>
      <Textarea
        ref={input}
        id={id}
        sizing="fixed"
        required
        value={value}
        {...suggestions.inputProps}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (!event.nativeEvent.isComposing && suggestions.key(event.key)) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      />
      <MentionSuggestions suggestions={suggestions} />
    </div>
  );
}
