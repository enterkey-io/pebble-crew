import { Combobox } from '../ui/combobox';
import { LoadingBar } from '../ui/loading-bar';
export type ModelSelection =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'read-only'; label: string }
  | {
      kind: 'choice';
      state: 'ready' | 'pending' | 'success' | 'refused' | 'uncertain';
      options: readonly { value: string; label: string }[];
      value: string | null;
      onSelect: (value: string) => void;
      message?: string;
    };
export function ModelSelector({ value }: { value: ModelSelection }) {
  if (value.kind === 'unavailable')
    return <p className="text-xs text-muted-foreground">{value.reason}</p>;
  if (value.kind === 'read-only')
    return <span className="text-sm text-muted-foreground">{value.label}</span>;
  return (
    <div className="grid gap-2">
      <Combobox
        label="Model"
        options={value.options}
        value={value.value}
        onValueChange={value.onSelect}
        disabled={value.state === 'pending' || value.state === 'uncertain'}
      />
      {value.state === 'pending' && <LoadingBar active label="Changing model" />}
      {value.message && (
        <p
          role={value.state === 'refused' ? 'alert' : 'status'}
          className="text-xs text-muted-foreground"
        >
          {value.message}
        </p>
      )}
    </div>
  );
}
