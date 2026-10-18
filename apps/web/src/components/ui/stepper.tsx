import { Check } from 'lucide-react';
import { cn } from 'cn';

export type Step = {
  readonly id: string;
  readonly label: string;
  readonly state: 'complete' | 'current' | 'pending';
};
export function Stepper({ steps, label = 'Progress' }: { steps: readonly Step[]; label?: string }) {
  return (
    <ol data-slot="stepper" aria-label={label} className="flex min-w-0 flex-wrap gap-4">
      {steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-2 text-sm',
            step.state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs"
          >
            {step.state === 'complete' ? <Check className="size-3.5" /> : index + 1}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
