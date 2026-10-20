import { Activity } from './activity';
import { ToolOutput } from './tool';
export type StackFrame = {
  readonly id: string;
  readonly function: string;
  readonly file: string;
  readonly line: number | null;
};
export type StackTraceValue =
  | { kind: 'empty' }
  | { kind: 'malformed'; text: string }
  | { kind: 'frames' | 'partial'; message: string; frames: readonly StackFrame[] };
export function StackTrace({ value }: { value: StackTraceValue }) {
  if (value.kind === 'empty') return null;
  return (
    <Activity title="Error details" state="failed">
      {value.kind === 'malformed' ? (
        <ToolOutput title="Error" value={value.text} />
      ) : (
        <div className="grid gap-3">
          <p className="text-sm">{value.message}</p>
          <ol className="grid gap-2 font-mono text-xs text-muted-foreground">
            {value.frames.map((x) => (
              <li key={x.id} className="break-all">
                <span className="text-foreground">{x.function}</span>
                <br />
                {x.file}
                {x.line === null ? '' : `:${x.line}`}
              </li>
            ))}
          </ol>
          {value.kind === 'partial' && (
            <p className="text-xs text-muted-foreground">Some frames are unavailable.</p>
          )}
        </div>
      )}
    </Activity>
  );
}
