import { Progress } from '../ui/progress';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
export type ContextValue =
  | { kind: 'unknown' }
  | { kind: 'unavailable' }
  | { kind: 'available' | 'stale'; used: number; capacity: number; unit: string };
export function Context({ value }: { value: ContextValue }) {
  if (value.kind === 'unknown' || value.kind === 'unavailable')
    return <span className="text-xs text-muted-foreground">Context {value.kind}</span>;
  const percent =
    value.capacity > 0 ? Math.min(100, Math.max(0, (value.used / value.capacity) * 100)) : null;
  return (
    <Popover>
      <PopoverTrigger className="min-h-8 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2">
        {percent === null ? 'Context' : `${Math.round(percent)}% context`}
        {value.kind === 'stale' ? ' · earlier' : ''}
      </PopoverTrigger>
      <PopoverContent className="grid gap-3 text-sm">
        <p>
          {value.used.toLocaleString()} / {value.capacity.toLocaleString()} {value.unit}
        </p>
        {percent !== null && <Progress value={percent} aria-label="Context used" />}
        {value.kind === 'stale' && (
          <p className="text-xs text-muted-foreground">Last reported measurement</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
