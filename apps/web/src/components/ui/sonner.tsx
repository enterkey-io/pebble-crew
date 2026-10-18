import { CheckCircle2, CircleAlert, Info, LoaderCircle, XCircle } from 'lucide-react';
import { Toaster as Notifications, toast, type ToasterProps } from 'sonner';

/** Notifications share the application theme; they never introduce a theme provider. */
export function Toaster(props: ToasterProps) {
  return (
    <Notifications
      theme="dark"
      position="bottom-right"
      icons={{
        success: <CheckCircle2 className="size-4" />,
        info: <Info className="size-4" />,
        warning: <CircleAlert className="size-4" />,
        error: <XCircle className="size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full items-center gap-3 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl',
          content: 'flex-1',
          description: 'mt-1 text-muted-foreground',
          actionButton: 'rounded-md px-2 py-1 font-medium focus-visible:outline-2',
          cancelButton: 'rounded-md px-2 py-1 text-muted-foreground',
          closeButton: 'rounded-full bg-popover text-popover-foreground',
        },
      }}
      {...props}
    />
  );
}
export { toast };
