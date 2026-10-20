import { Activity } from './activity';
import type { RunState } from './states';
export type PublicReasoning =
  | { kind: 'absent' }
  | { kind: 'public-summary'; state: Exclude<RunState, 'running' | 'unknown'>; summary: string };
export function Reasoning({ value }: { value: PublicReasoning }) {
  return value.kind === 'absent' ? null : (
    <Activity title="Summary" state={value.state}>
      {value.summary && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {value.summary}
        </p>
      )}
    </Activity>
  );
}
