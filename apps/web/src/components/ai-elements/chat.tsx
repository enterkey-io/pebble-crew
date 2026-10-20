import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export type ChatState = 'empty' | 'loading' | 'ready' | 'restoring' | 'disconnected';
/** Passive anatomy. The caller's TranscriptFollow is the only viewport controller. */
export function Chat({
  state,
  reader = 'follow',
  className,
  ...props
}: ComponentProps<'section'> & { state: ChatState; reader?: 'follow' | 'manual' }) {
  return (
    <section
      data-slot="ai-chat"
      data-state={state}
      data-reader={reader}
      aria-busy={state === 'loading'}
      className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col', className)}
      {...props}
    />
  );
}
export function ChatViewport({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="ai-chat-viewport"
      className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain', className)}
      {...props}
    />
  );
}
