import type { ComponentProps } from 'react';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';

export function RoleLabel({ className, ...props }: Omit<ComponentProps<typeof Badge>, 'variant'>) {
  return (
    <Badge
      variant="secondary"
      data-slot="role-label"
      className={cn(
        'block min-w-0 max-w-full shrink truncate rounded px-1 py-0 text-xs font-normal leading-5',
        className,
      )}
      {...props}
    />
  );
}
