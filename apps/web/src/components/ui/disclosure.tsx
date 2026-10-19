import type { ComponentProps, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from 'cn';
import { Button } from './button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';

export function Disclosure({
  title,
  description,
  children,
  className,
  contentClassName,
  disabled = false,
  ...props
}: Omit<ComponentProps<typeof Collapsible>, 'title' | 'children'> & {
  title: string;
  description?: string;
  children: ReactNode;
  contentClassName?: string;
  disabled?: boolean;
}) {
  return (
    <Collapsible data-slot="disclosure" className={cn('min-w-0', className)} {...props}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="quiet"
          disabled={disabled}
          className="group/disclosure min-h-11 h-auto w-full justify-between gap-4 whitespace-normal px-0 py-2 text-left text-foreground has-[>svg]:px-0"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium leading-5">{title}</span>
            {description && (
              <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                {description}
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-overlay)] group-data-[state=open]/disclosure:rotate-180 motion-reduce:transition-none"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent data-slot="disclosure-content" className="overflow-clip">
        <div
          data-slot="disclosure-body"
          className={cn(
            'grid min-w-0 gap-4 pt-2 pb-1 [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-muted-foreground [&>[data-slot=button]]:max-w-full [&>[data-slot=button]]:justify-self-start [&>[data-slot=button]]:whitespace-normal [&>[data-slot=button]]:h-auto [&>[data-slot=button]]:min-h-9',
            contentClassName,
          )}
        >
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
