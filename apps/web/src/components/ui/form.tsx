import type { ComponentProps } from 'react';
import { cn } from 'cn';

export function Form({ className, ...props }: ComponentProps<'form'>) {
  return <form data-slot="form" className={cn('grid min-w-0 gap-5', className)} {...props} />;
}
