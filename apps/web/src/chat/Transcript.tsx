import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentTrigger,
} from '../components/ui/attachment';
import { FileText } from 'lucide-react';
import { fileSize } from './FilesPanel';
import { MessageBubble, MessageMetadata } from '../components/ai-elements/message';
import { ChainOfThought } from '../components/ai-elements/chain-of-thought';
import { Tool } from '../components/ai-elements/tool';
import { useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { motion, useReducedMotion } from 'motion/react';
import { MessageBody, CopyMessage } from '../MessageBody';
import { messageDate } from '../conversation';
import { projectTimeline } from './presentation';
import type { ChatMessage } from '../conversation';
import { MessageReactions, ReactionPicker } from './MessageReactions';
import type { ReactionAction } from './MessageReactions';
import { ActivityLine } from './ActivityLine';
import { ownerBubbleStyle } from './bubble-color';
export function Transcript({
  conversationKey,
  messages,
  title,
  crew,
  stream,
  running,
  activity,
  reply,
  children,
  authorName,
  onDownloadFile,
  onReact,
  client,
  sessionId,
  ownerColor,
  footer,
}: {
  conversationKey: string;
  messages: ChatMessage[];
  title: string;
  crew: boolean;
  stream: string;
  running: boolean;
  activity: string;
  reply: { renderKey: string; timestamp: string };
  children?: ReactNode;
  authorName: (name: string) => string;
  onDownloadFile: (file: { id: string; name: string }) => void;
  onReact?: ReactionAction | undefined;
  client?: BotBridgeClient | undefined;
  sessionId?: string | undefined;
  ownerColor?: string | undefined;
  footer?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const displayed: ChatMessage[] = stream
    ? [...messages, { ...reply, id: reply.renderKey, role: 'assistant', text: stream }]
    : messages;
  const timeline = projectTimeline(displayed);
  const keys = timeline.map((item, i) =>
    item.kind === 'activity'
      ? item.id
      : (item.message.renderKey ?? item.message.id ?? `pending-${i}`),
  );
  const signature = JSON.stringify(keys);
  const [seen, setSeen] = useState(() => ({ conversationKey, keys: new Set(keys) }));
  useLayoutEffect(() => {
    setSeen({ conversationKey, keys: new Set<string>(JSON.parse(signature)) });
  }, [conversationKey, signature]);
  let previous = '';
  return (
    <div className="pc-messages">
      {children}
      {timeline.map((item, i) => {
        if (item.kind === 'activity')
          return (
            <div className="activity-group" key={item.id}>
              <ChainOfThought
                state="unknown"
                title={
                  item.messages.some((m) => m.role === 'tool')
                    ? `${item.messages.length} tool ${item.messages.length === 1 ? 'call' : 'calls'}`
                    : 'Activity'
                }
              >
                <div className="grid gap-3">
                  {item.messages.map((m, index) => (
                    <Tool
                      key={m.id ?? index}
                      id={m.id ?? String(index)}
                      name={m.toolName ?? 'Update'}
                      state="unknown"
                      defaultOpen
                      input={m.context}
                      output={m.text.trim() ? m.text : undefined}
                    />
                  ))}
                </div>
              </ChainOfThought>
            </div>
          );
        const m = item.message;
        const key = m.renderKey ?? m.id ?? `pending-${i}`;
        const entering = seen.conversationKey === conversationKey && !seen.keys.has(key);
        const live = m.id === reply.renderKey;
        const react = !crew && m.id && /^[1-9]\d*$/.test(m.id) ? onReact : undefined;
        const date = messageDate(m.timestamp);
        const group =
          date?.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }) ?? '';
        const label = group && group !== previous;
        previous = group;
        return (
          <motion.div
            className={`pc-message message-group ${m.role}${live ? ' streaming' : ''}`}
            initial={entering && !reduced ? { opacity: 0, y: 10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            data-message-id={m.id ?? `pending-${i}`}
            key={key}
          >
            {label && <p className="pc-date date-divider">{group}</p>}
            <div className="pc-bubble-wrap">
              <MessageBubble
                className={`pc-bubble message ${m.role}`}
                style={m.role === 'user' ? ownerBubbleStyle(ownerColor) : undefined}
              >
                {crew && m.role === 'assistant' && (
                  <strong className="message-author">
                    {m.author ? authorName(m.author) : live ? title : 'Crew member'}
                  </strong>
                )}
                {m.role === 'tool' && <small className="message-author">Tool</small>}
                {m.text.trim() &&
                  (m.role === 'user' ? (
                    <p>{m.text}</p>
                  ) : (
                    <MessageBody
                      text={m.text}
                      client={client}
                      sessionId={sessionId}
                      rowId={m.id}
                      conversationKey={conversationKey}
                    />
                  ))}
                {m.files?.map((file) => (
                  <Attachment key={file.id} className="message-file my-1" size="sm" state="done">
                    <AttachmentMedia>
                      <FileText />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{file.name}</AttachmentTitle>
                      <AttachmentDescription>{fileSize(file.size)}</AttachmentDescription>
                    </AttachmentContent>
                    <AttachmentTrigger
                      aria-label={`Download ${file.name}`}
                      onClick={() => onDownloadFile(file)}
                    />
                  </Attachment>
                ))}
                <MessageMetadata className="pc-message-meta message-meta">
                  {date && (
                    <time dateTime={date.toISOString()}>
                      {date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </time>
                  )}
                </MessageMetadata>
              </MessageBubble>
              <MessageReactions
                id={m.id ?? ''}
                reactions={m.reactions ?? []}
                agentName={title}
                onReact={react}
              />
            </div>
            {(m.text.trim() || m.files?.length) && (
              <div className="pc-message-actions">
                {!crew && onReact && m.id && (
                  <ReactionPicker
                    id={m.id}
                    reactions={m.reactions ?? []}
                    onReact={onReact}
                    disabled={!react}
                  />
                )}
                {m.text.trim() && <CopyMessage text={m.text} />}
              </div>
            )}
          </motion.div>
        );
      })}
      {footer}
      <ActivityLine
        key={conversationKey}
        active={!!conversationKey && running}
        label={activity === 'Stop requested' ? 'Stopping' : activity}
      />
    </div>
  );
}
