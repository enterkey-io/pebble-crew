import { useRef, useState } from 'react';
import { useOverlayHistory } from '../ui/overlay-history';
import { IconButton } from '../components/ui/icon-button';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../components/ui/sheet';

export function Drawer({
  title,
  children,
  onClose,
  onBeforeClose,
  variant = 'drawer',
  sizing = 'editor',
  restoreFocus,
}: {
  title: string;
  children: ReactNode;
  onClose: () => boolean | void;
  onBeforeClose?: () => boolean;
  variant?: 'drawer' | 'dialog';
  sizing?: 'editor' | 'content';
  restoreFocus?: () => HTMLElement | null;
}) {
  const [open, setOpen] = useState(true);
  const content = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const trigger = useRef(document.activeElement);
  const before = useRef(onBeforeClose);
  before.current = onBeforeClose;
  function requestClose() {
    if (before.current?.() === false) return false;
    setOpen(false);
    return true;
  }
  const request = useRef(requestClose);
  request.current = requestClose;
  useOverlayHistory(true, () => request.current());
  function afterClose(event: Event) {
    if (!open && close.current() === false) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    event.preventDefault();
    requestAnimationFrame(() => {
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const previous = trigger.current;
      const destination =
        restoreFocus?.() ??
        (previous instanceof HTMLElement &&
        previous.isConnected &&
        previous.matches('button,a,input,textarea,[tabindex]')
          ? previous
          : document.querySelector<HTMLElement>(
              '.pc-chat-identity,.pc-rail-header [aria-label="New"]',
            ));
      destination?.focus({ preventScroll: true });
    });
  }
  function focusContent(event: Event) {
    event.preventDefault();
    const dialog = content.current;
    (
      dialog?.querySelector<HTMLElement>(
        '[data-autofocus],[role="tab"][data-state="active"],input:not([type="file"]),textarea',
      ) ?? dialog
    )?.focus();
  }
  return variant === 'dialog' ? (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) setOpen(true);
        else requestClose();
      }}
    >
      <DialogContent
        ref={content}
        size={sizing}
        className={sizing === 'content' ? 'pc-work-dialog' : 'product-dialog'}
        showCloseButton={false}
        aria-label={title}
        onOpenAutoFocus={focusContent}
        onCloseAutoFocus={afterClose}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{title}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (value) setOpen(true);
        else requestClose();
      }}
    >
      <SheetContent
        ref={content}
        className="product-sheet"
        size="panel"
        side={title === 'navigation' ? 'left' : 'right'}
        aria-label={title}
        showCloseButton={false}
        onOpenAutoFocus={focusContent}
        onCloseAutoFocus={afterClose}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{title}</SheetDescription>
        {title !== 'navigation' && (
          <div className="sheet-actions">
            <IconButton label={`Close ${title}`} icon={X} onClick={requestClose} />
          </div>
        )}
        {children}
      </SheetContent>
    </Sheet>
  );
}
