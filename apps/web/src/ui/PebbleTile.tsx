import type { ComponentProps, ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { RoleLabel } from './RoleLabel';

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
      className="pc-pin-open [&_.agent-avatar]:h-15 [&_.agent-avatar]:w-14 grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[60px_20px_auto] content-start items-center justify-items-center gap-1 rounded-lg px-2 py-2 text-foreground hover:bg-transparent dark:hover:bg-transparent max-md:grid-rows-[76px_20px_auto] max-md:py-1 max-md:[&_.agent-avatar]:h-19 max-md:[&_.agent-avatar]:w-18"
    >
      {avatar}
      <strong className="max-w-full truncate text-sm font-medium leading-5">{name}</strong>{' '}
      {title && (
        <RoleLabel
          aria-hidden="true"
          variant="outline"
          className="pc-pin-title rounded-md px-1.5 leading-4 wrap-anywhere whitespace-normal text-center text-secondary-foreground"
        >
          {title}
        </RoleLabel>
      )}
      {children}
    </Button>
  );
}
