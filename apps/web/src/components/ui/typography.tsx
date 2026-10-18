import type { HTMLAttributes } from 'react';
import { cn } from 'cn';

const variants = {
  h1: 'text-2xl font-semibold tracking-tight',
  h2: 'text-lg font-semibold tracking-tight',
  h3: 'text-base font-medium',
  p: 'text-sm leading-relaxed',
  small: 'text-xs text-muted-foreground',
  blockquote: 'border-l-2 border-border pl-4 text-sm text-muted-foreground',
  code: 'rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]',
};
export function Typography({
  as: Component = 'p',
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: keyof typeof variants }) {
  return (
    <Component data-slot="typography" className={cn(variants[Component], className)} {...props} />
  );
}
