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
      className="pc-pin-open [&_.agent-avatar]:h-15 [&_.agent-avatar]:w-14 grid h-auto min-h-[156px] w-full min-w-0 grid-rows-[60px_20px_auto] content-start items-center justify-items-center gap-1.5 rounded-lg px-2 pt-5 pb-3.5 text-foreground hover:bg-transparent dark:hover:bg-transparent max-md:min-h-[164px] max-md:grid-rows-[76px_20px_auto] max-md:pt-4 max-md:pb-3 max-md:[&_.agent-avatar]:h-19 max-md:[&_.agent-avatar]:w-18"
    >
      {avatar}
      <strong className="max-w-full truncate text-sm font-medium leading-5">{name}</strong>{' '}
      {title && (
        <RoleLabel aria-hidden="true" className="pc-pin-title whitespace-normal text-center">
          {title}
        </RoleLabel>
      )}
      {children}
    </Button>
  );
}
