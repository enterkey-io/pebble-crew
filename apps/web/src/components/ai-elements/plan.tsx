import { Check, Circle, CircleAlert } from 'lucide-react';
import { Activity } from './activity';
import type { RunState } from './states';
export type PlanStep = {
  readonly id: string;
  readonly title: string;
  readonly state: 'pending' | 'active' | 'done' | 'failed';
};
export function Plan({
  title = 'Plan',
  state,
  steps,
}: {
  title?: string;
  state: Exclude<RunState, 'running' | 'unknown'>;
  steps: readonly PlanStep[];
}) {
  return (
    <Activity title={title} state={state}>
      {steps.length > 0 && (
        <ol className="grid gap-3">
          {steps.map((step) => (
            <li key={step.id} className="flex min-w-0 gap-2 text-sm">
              <span className="mt-0.5 shrink-0">
                {step.state === 'done' ? (
                  <Check aria-label="Complete" className="size-4" />
                ) : step.state === 'failed' ? (
                  <CircleAlert aria-label="Failed" className="size-4 text-destructive" />
                ) : (
                  <Circle
                    aria-label={step.state === 'active' ? 'Active' : 'Pending'}
                    className="size-4 text-muted-foreground"
                  />
                )}
              </span>
              <span className={step.state === 'pending' ? 'text-muted-foreground' : undefined}>
                {step.title}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Activity>
  );
}
