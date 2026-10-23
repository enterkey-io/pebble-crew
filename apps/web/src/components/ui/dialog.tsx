import * as React from 'react';
import { cn } from 'cn';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { Button } from '@/components/ui/button';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  variant?: 'default' | 'image';
  size?: 'default' | 'editor' | 'content';
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={variant === 'image' ? 'bg-black/95' : undefined} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-variant={variant}
        className={cn(
          variant === 'image'
            ? 'fixed inset-x-0 top-[var(--app-viewport-top,0px)] z-50 flex h-[var(--app-viewport-height,100dvh)] w-screen flex-col overflow-hidden border-0 bg-transparent p-0 text-white shadow-none duration-[var(--motion-overlay)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0'
            : 'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-[18px] border-0 bg-card p-6 shadow-[0_24px_90px_#0009] duration-[var(--motion-overlay)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 sm:max-w-lg max-md:top-[calc(var(--app-viewport-top,0px)+var(--app-viewport-height,100dvh)/2)] max-md:max-h-[calc(var(--app-viewport-height,100dvh)-24px)] any-pointer-coarse:top-[calc(var(--app-viewport-top,0px)+var(--app-viewport-height,100dvh)/2)] any-pointer-coarse:max-h-[calc(var(--app-viewport-height,100dvh)-24px)]',
          size === 'editor' &&
            'flex h-[min(640px,calc(100dvh-48px))] w-[640px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-clip p-0 sm:max-w-[640px] max-md:h-[calc(var(--app-viewport-height,100dvh)-32px)]',
          size === 'content' &&
            'top-[max(24px,8dvh)] translate-y-0 max-md:top-[calc(var(--app-viewport-top,0px)+16px)] any-pointer-coarse:top-[calc(var(--app-viewport-top,0px)+16px)] flex h-auto max-h-[calc(var(--app-viewport-height,100dvh)-max(48px,16dvh))] max-md:max-h-[calc(var(--app-viewport-height,100dvh)-32px)] any-pointer-coarse:max-h-[calc(var(--app-viewport-height,100dvh)-32px)] w-[560px] max-w-[calc(100vw-32px)] flex-col overflow-hidden sm:max-w-[560px]',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-2 right-2 flex size-11 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity duration-[var(--motion-hover)] hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
