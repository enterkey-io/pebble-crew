import { cn } from '../../lib/utils';
import type { ReactNode, KeyboardEvent, ComponentProps } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
export { Textarea as PromptInputField } from '../ui/textarea';
export function PromptInputFrame({ className, ...props }: ComponentProps<'form'>) {
  return (
    <form
      data-slot="prompt-input"
      className={cn('flex min-w-0 items-end gap-2 rounded-3xl bg-secondary p-2.5', className)}
      {...props}
    />
  );
}
export type PromptAction =
  | { kind: 'empty' | 'uploading' | 'sending' | 'stopping'; label: string }
  | { kind: 'draft' | 'ready' | 'error'; onSend: () => void }
  | { kind: 'running'; onStop: () => void };
export function PromptInput({
  value,
  onValueChange,
  action,
  attachments,
  menu,
  placeholder = 'Message',
  onKeyDown,
}: {
  value: string;
  onValueChange: (value: string) => void;
  action: PromptAction;
  attachments?: ReactNode;
  menu?: ReactNode;
  placeholder?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const send =
    action.kind === 'draft' || action.kind === 'ready' || action.kind === 'error'
      ? action.onSend
      : undefined;
  return (
    <PromptInputFrame
      className="flex-col items-stretch"
      onSubmit={(event) => {
        event.preventDefault();
        send?.();
      }}
    >
      {attachments}
      <div className="flex min-w-0 items-end gap-2">
        {menu}
        <Textarea
          aria-label="Message"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          className="min-h-11 max-h-40 resize-none border-0 bg-transparent px-1 py-2.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (
              !e.defaultPrevented &&
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              send
            ) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button
          type="button"
          size="icon-lg"
          className="mb-0.5 rounded-full"
          aria-label={action.kind === 'running' ? 'Stop' : 'Send'}
          disabled={action.kind !== 'running' && !send}
          onClick={action.kind === 'running' ? action.onStop : send}
        >
          {action.kind === 'running' ? <Square /> : <ArrowUp />}
        </Button>
      </div>
    </PromptInputFrame>
  );
}
