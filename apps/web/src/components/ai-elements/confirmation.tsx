import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '../ui/button';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '../ui/item';
import { LoadingBar } from '../ui/loading-bar';
export type ConfirmationValue =
  | { kind: 'pending'; disabled?: boolean; onDecision: (decision: 'once' | 'deny') => void }
  | {
      kind:
        'submitting' | 'approved' | 'denied' | 'expired' | 'superseded' | 'failed' | 'uncertain';
      message: string;
    };
export function ApprovalSurface({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Item asChild variant="muted" className={className}>
      <article data-slot="confirmation" className="flex-col items-stretch gap-4">
        <ItemContent>
          <ItemTitle>
            <ShieldCheck className="size-4" aria-hidden="true" />
            <h3>{title}</h3>
          </ItemTitle>
          <ItemDescription className="line-clamp-none">{description}</ItemDescription>
        </ItemContent>
        {children}
      </article>
    </Item>
  );
}
export function Confirmation({
  title,
  description,
  details,
  value,
  className,
}: {
  title: string;
  description: string;
  details?: ReactNode;
  value: ConfirmationValue;
  className?: string;
}) {
  return (
    <ApprovalSurface title={title} description={description} {...(className ? { className } : {})}>
      {details}
      {value.kind === 'pending' ? (
        <ItemActions className="justify-end">
          <Button
            disabled={value.disabled ?? false}
            variant="quiet"
            onClick={() => value.onDecision('deny')}
          >
            Deny
          </Button>
          <Button disabled={value.disabled ?? false} onClick={() => value.onDecision('once')}>
            Allow once
          </Button>
        </ItemActions>
      ) : (
        <div className="grid gap-2">
          {value.kind === 'submitting' && <LoadingBar active label="Responding" />}
          <p
            className="text-xs text-muted-foreground"
            role={value.kind === 'failed' ? 'alert' : 'status'}
          >
            {value.message}
          </p>
        </div>
      )}
    </ApprovalSurface>
  );
}
