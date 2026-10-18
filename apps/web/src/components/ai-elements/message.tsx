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
  author?: string | undefined;
  children: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  reactions?: ReactNode;
  style?: CSSProperties | undefined;
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
        {role === 'user' ? (
          <Bubble variant="muted" align="end">
            <BubbleContent style={style}>{children}</BubbleContent>
            {reactions}
          </Bubble>
        ) : (
          <div data-slot="message-response" className="relative min-w-0">
            {children}
            {reactions}
          </div>
        )}
        {(metadata || actions) && (
          <MessageFooter className="min-h-8 gap-1 px-0 tabular-nums">
            {actions}
            {metadata && <span className="ml-1 whitespace-nowrap">{metadata}</span>}
          </MessageFooter>
        )}
      </MessageContent>
    </Frame>
  );
}
