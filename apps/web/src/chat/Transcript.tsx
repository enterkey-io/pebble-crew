import { useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { motion, useReducedMotion } from 'motion/react';
import { MessageBody, CopyMessage } from '../MessageBody';
import { messageDate, projectTimeline } from '../conversation';
import type { ChatMessage } from '../conversation';
import { MessageReactions, ReactionPicker } from './MessageReactions';
import type { ReactionAction } from './MessageReactions';
import { ActivityLine } from './ActivityLine';
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
}) {
  const reduced = useReducedMotion();
  const displayed = stream
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
            <details className="activity-group" key={item.id}>
              <summary>
                {item.messages.some((m) => m.role === 'tool')
                  ? `${item.messages.length} tool ${item.messages.length === 1 ? 'call' : 'calls'}`
                  : 'Activity'}
              </summary>
              <ol>
                {item.messages.map((m, index) => (
                  <li key={m.id ?? index}>
                    <strong>{m.toolName ?? 'Update'}</strong>
                    {m.context && <p>{m.context}</p>}
                    {m.text.trim() && <MessageBody text={m.text} />}
                  </li>
                ))}
              </ol>
            </details>
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
              <article className={`pc-bubble message ${m.role}`}>
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
                  <button
                    className="message-file"
                    key={file.id}
                    onClick={() => onDownloadFile(file)}
                  >
                    {file.name} ↓
                  </button>
                ))}
                <div className="pc-message-meta message-meta">
                  {date && (
                    <time dateTime={date.toISOString()}>
                      {date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </time>
                  )}
                </div>
              </article>
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
      <ActivityLine
        key={conversationKey}
        active={!!conversationKey && running}
        label={activity === 'Stop requested' ? 'Stopping' : activity}
      />
    </div>
  );
}
