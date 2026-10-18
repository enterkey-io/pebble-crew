import { Button } from '../ui/button';
export type SuggestionValue =
  { kind: 'ready' | 'selected'; onSelect: () => void } | { kind: 'disabled' };
export function Suggestion({ children, value }: { children: string; value: SuggestionValue }) {
  return (
    <Button
      variant="outline"
      className="h-auto max-w-full whitespace-normal rounded-full px-3 py-2 text-left font-normal"
      disabled={value.kind === 'disabled'}
      aria-pressed={value.kind === 'selected'}
      onClick={value.kind === 'disabled' ? undefined : value.onSelect}
    >
      {children}
    </Button>
  );
}
