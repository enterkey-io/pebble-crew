import type { ReactNode } from 'react';
import { Activity } from './activity';
import type { RunState } from './states';
export type PublicActivityStep = {
  readonly id: string;
  readonly label: string;
  readonly state: RunState;
  readonly detail?: ReactNode;
};
type ChainProps = { state: RunState; title?: string } & (
  | { steps: readonly PublicActivityStep[]; children?: never }
  | { children: ReactNode; steps?: never }
);
/** Public activity only; provider analysis never enters this contract. */
export function ChainOfThought({ state, title = 'Activity', steps, children }: ChainProps) {
  return (
    <Activity title={title} state={state}>
      {steps
        ? steps.length > 0 && (
            <ol className="grid gap-3">
              {steps.map((step) => (
                <li key={step.id}>
                  <Activity title={step.label} state={step.state}>
                    {step.detail && (
                      <div className="text-sm whitespace-pre-wrap text-muted-foreground">
                        {step.detail}
                      </div>
                    )}
                  </Activity>
                </li>
              ))}
            </ol>
          )
        : children}
    </Activity>
  );
}
