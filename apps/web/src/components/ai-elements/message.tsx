import type * as React from 'react';
import { cn } from '../../lib/utils';
import type { CSSProperties, ReactNode } from 'react';
import { Message as Frame, MessageContent, MessageHeader, MessageFooter } from '../ui/message';
import { Bubble, BubbleContent } from '../ui/bubble';
export type MessagePhase = 'pending' | 'live' | 'committed' | 'failed' | 'cancelled';
export function Message({
  id,
  role,
  state,
  author,
  children,
  metadata,
  actions,
  reactions,
  style,
  className,
}: {
  id: string;
  role: 'user' | 'agent' | 'member';
  state: MessagePhase;
  author?: string;
  children: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  reactions?: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <Frame
      align={role === 'user' ? 'end' : 'start'}
      data-receipt={id}
      data-phase={state}
      className={className}
    >
      <MessageContent>
        {author && <MessageHeader>{author}</MessageHeader>}
        <div className="relative max-w-full min-w-0">
          <Bubble variant="muted" align={role === 'user' ? 'end' : 'start'} className="max-w-full">
            <MessageBubble style={style}>{children}</MessageBubble>
          </Bubble>
          {reactions}
        </div>
        {metadata && <MessageFooter className="min-h-4 tabular-nums">{metadata}</MessageFooter>}
        {actions}
      </MessageContent>
    </Frame>
  );
}

/** The product keeps its receipt-keyed outer row; this slot shares bubble anatomy. */
export function MessageBubble({ className, children, ...props }: React.ComponentProps<'article'>) {
  return (
    <BubbleContent asChild className={cn('w-auto border-0', className)}>
      <article {...props}>{children}</article>
    </BubbleContent>
  );
}
export function MessageMetadata({
  className,
  ...props
}: React.ComponentProps<typeof MessageFooter>) {
  return <MessageFooter className={cn('px-0', className)} {...props} />;
}
