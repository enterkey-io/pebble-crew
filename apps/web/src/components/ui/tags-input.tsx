import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from './input';
import { Button } from './button';

export function TagsInput({
  label,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  value: readonly string[];
  onValueChange: (tags: readonly string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  function commit() {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) onValueChange([...value, tag]);
    setDraft('');
  }
  return (
    <div data-slot="tags-input" className="grid gap-2">
      {!!value.length && (
        <ul aria-label={`${label} selected`} className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <li
              key={tag}
              className="flex items-center gap-1 rounded-md bg-secondary py-0.5 pl-2.5 text-sm"
            >
              <span>{tag}</span>
              <Button
                type="button"
                variant="quiet"
                size="icon-sm"
                aria-label={`Remove ${tag}`}
                disabled={disabled}
                onClick={() => onValueChange(value.filter((item) => item !== tag))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Input
        aria-label={label}
        value={draft}
        disabled={disabled}
        maxLength={80}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Backspace' && !draft && value.length)
            onValueChange(value.slice(0, -1));
        }}
      />
    </div>
  );
}
