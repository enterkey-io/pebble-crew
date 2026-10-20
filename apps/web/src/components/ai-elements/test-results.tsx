import { Check, X, Minus } from 'lucide-react';
import { Activity } from './activity';
import type { RunState } from './states';
export type TestCase = {
  readonly id: string;
  readonly suite: string;
  readonly name: string;
  readonly outcome: 'passed' | 'failed' | 'skipped';
  readonly detail?: string;
};
export function TestResults({
  state,
  cases,
}: {
  state: Exclude<RunState, 'streaming' | 'unknown'>;
  cases: readonly TestCase[];
}) {
  const passed = cases.filter((x) => x.outcome === 'passed').length;
  const failed = cases.filter((x) => x.outcome === 'failed').length;
  return (
    <Activity
      title="Tests"
      state={state}
      detail={cases.length ? `${passed} passed${failed ? `, ${failed} failed` : ''}` : undefined}
    >
      {cases.length > 0 && (
        <ul className="grid gap-2">
          {cases.map((x) => (
            <li key={x.id} className="text-sm">
              <div className="flex items-center gap-2">
                {x.outcome === 'passed' ? (
                  <Check aria-label="Passed" className="size-3.5" />
                ) : x.outcome === 'failed' ? (
                  <X aria-label="Failed" className="size-3.5 text-destructive" />
                ) : (
                  <Minus aria-label="Skipped" className="size-3.5" />
                )}
                <span className="min-w-0 break-words">
                  {x.suite} · {x.name}
                </span>
              </div>
              {x.detail && (
                <p className="ml-6 whitespace-pre-wrap text-xs text-muted-foreground">
                  {x.detail.slice(0, 8000)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Activity>
  );
}
