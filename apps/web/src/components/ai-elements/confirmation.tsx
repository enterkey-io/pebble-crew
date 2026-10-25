import { ButtonGroup } from '../ui/button-group';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';
import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '../ui/item';
import { LoadingBar } from '../ui/loading-bar';
import { Disclosure } from '../ui/disclosure';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { ChevronRight, ChevronDown } from 'lucide-react';

type ConfirmationChoice = 'once' | 'session' | 'always' | 'deny';
export type ConfirmationValue =
  | {
      kind: 'pending';
      disabled?: boolean;
      choices?: readonly ConfirmationChoice[] | undefined;
      onDecision: (decision: ConfirmationChoice) => void;
    }
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
  icon: Icon = ShieldCheck,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
}) {
  return (
    <Item asChild variant="muted" className={className}>
      <article data-slot="confirmation" className="flex-col items-stretch gap-4">
        <ItemContent>
          <ItemTitle>
            <Icon className="size-4" aria-hidden="true" />
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
  compact = false,
}: {
  title: string;
  description: string;
  compact?: boolean;
  details?: ReactNode;
  value: ConfirmationValue;
  className?: string;
}) {
  const terminal = !['pending', 'submitting'].includes(value.kind);
  const full = (
    <ApprovalSurface
      title={title}
      description={
        compact && !terminal ? (
          <span className="line-clamp-2 break-words">{description}</span>
        ) : (
          description
        )
      }
      {...(className ? { className } : {})}
    >
      {compact && !terminal && (description.length > 160 || details) ? (
        <Disclosure title="Read more">
          <div className="max-h-[24dvh] overflow-y-auto overscroll-contain">
            <p className="whitespace-pre-wrap break-words">{description}</p>
            {details}
          </div>
        </Disclosure>
      ) : (
        details
      )}
      {value.kind === 'pending' ? (
        <ItemActions className="justify-end">
          <Button
            disabled={value.disabled ?? false}
            variant="quiet"
            onClick={() => value.onDecision('deny')}
          >
            Deny
          </Button>
          <ButtonGroup>
            {(value.choices ?? ['once', 'deny']).includes('once') && (
              <Button disabled={value.disabled ?? false} onClick={() => value.onDecision('once')}>
                Allow once
              </Button>
            )}
            {value.choices?.some((choice) => choice === 'session' || choice === 'always') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    disabled={value.disabled ?? false}
                    aria-label="More approval options"
                  >
                    <ChevronDown className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {value.choices.includes('session') && (
                    <DropdownMenuItem onSelect={() => value.onDecision('session')}>
                      Allow for this session
                    </DropdownMenuItem>
                  )}
                  {value.choices.includes('always') && (
                    <DropdownMenuItem onSelect={() => value.onDecision('always')}>
                      Always allow this action
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </ButtonGroup>
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
  return compact && terminal ? (
    <Collapsible data-slot="approval-receipt" className="group/receipt min-w-0">
      <CollapsibleTrigger asChild>
        <Button
          variant="quiet"
          className="h-auto max-w-full justify-start px-0 text-left whitespace-normal"
        >
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{value.kind !== 'pending' && value.message}</span>
          <ChevronRight
            className="size-3 shrink-0 transition-transform group-data-[state=open]/receipt:rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{full}</CollapsibleContent>
    </Collapsible>
  ) : (
    full
  );
}
