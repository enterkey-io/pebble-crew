import type { ComponentProps, ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

export function PebbleTile({
  avatar,
  name,
  title,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'title' | 'variant' | 'size' | 'className'> & {
  avatar: ReactNode;
  name: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <Button
      {...props}
      variant="ghost"
      className="pc-pin-open [&_.agent-avatar]:h-15 [&_.agent-avatar]:w-14 grid h-auto min-h-[156px] w-full min-w-0 grid-rows-[60px_20px_20px] content-start items-center justify-items-center gap-1.5 rounded-lg px-2 pt-5 pb-3.5 text-foreground hover:bg-transparent dark:hover:bg-transparent"
    >
      {avatar}
      <strong className="max-w-full truncate text-sm font-medium leading-5">{name}</strong>{' '}
      {title && (
        <Badge
          variant="secondary"
          aria-hidden="true"
          className="pc-pin-title block max-w-full truncate rounded px-1.5 py-0.5 text-xs font-normal leading-4"
        >
          {title}
        </Badge>
      )}
      {children}
    </Button>
  );
}
