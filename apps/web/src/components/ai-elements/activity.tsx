import type { ReactNode } from 'react';
import { Check, Circle, CircleAlert, Ban } from 'lucide-react';
import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from '../ui/trace';
import type { RunState } from './states';

export function Activity({
  title,
  state,
  children,
  detail,
  defaultOpen,
}: {
  title: string;
  state: RunState;
  children?: ReactNode;
  detail?: string | undefined;
  defaultOpen?: boolean | undefined;
}) {
  const icon =
    state === 'complete' ? (
      <Check />
    ) : state === 'failed' ? (
      <CircleAlert />
    ) : state === 'cancelled' ? (
      <Ban />
    ) : (
      <Circle />
    );
  const line = (
    <TraceLine
      status={
        state === 'failed'
          ? 'error'
          : state === 'running' || state === 'streaming'
            ? 'running'
            : state === 'pending'
              ? 'pending'
              : undefined
      }
    >
      <TraceIcon>{icon}</TraceIcon>
      <TraceTitle>{title}</TraceTitle>
      {detail && <TraceDescription>{detail}</TraceDescription>}
    </TraceLine>
  );
  return (
    <Trace data-run-state={state}>
      {children ? (
        <TraceCollapsible {...(defaultOpen === undefined ? {} : { defaultOpen })}>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        line
      )}
    </Trace>
  );
}
