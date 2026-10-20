import * as React from 'react';
import { cn } from 'cn';

function Textarea({
  className,
  sizing = 'content',
  ...props
}: React.ComponentProps<'textarea'> & { sizing?: 'content' | 'fixed' }) {
  return (
    <textarea
      data-slot="textarea"
      data-sizing={sizing}
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-[length:var(--text-composer)] dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
        sizing === 'content' ? 'field-sizing-content' : 'field-sizing-fixed',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
