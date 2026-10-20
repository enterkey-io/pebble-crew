import { toolGroupIcon } from '../components/ai-elements/activity-icons';
import { Activity as ActivityIcon } from 'lucide-react';
import { documentFormat } from '@hermes-client/protocol';
import { useDocumentActions } from '../documents/DocumentReader';
import { IconButton } from '../components/ui/icon-button';
import { Eye } from 'lucide-react';
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
import { Message } from '../components/ai-elements/message';
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
  liveIds,
  running,
  activity,
  children,
  authorName,
  authorAvatar,
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
  liveIds: ReadonlySet<string>;
  running: boolean;
  activity: string;
  children?: ReactNode;
  authorName: (name: string) => string;
  authorAvatar?: (name: string) => ReactNode;
  onDownloadFile: (file: { id: string; name: string }) => void;
  onReact?: ReactionAction | undefined;
  client?: BotBridgeClient | undefined;
  sessionId?: string | undefined;
  ownerColor?: string | undefined;
  footer?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const openDocument = useDocumentActions();
  const timeline = projectTimeline(messages);
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
                icon={
                  item.messages.some((m) => m.role === 'tool')
                    ? toolGroupIcon(item.messages.map((m) => m.toolName ?? ''))
                    : ActivityIcon
                }
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
                      icon={m.role === 'tool' ? undefined : ActivityIcon}
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
        const live = !!m.id && liveIds.has(m.id);
        const react =
          m.id && !m.id.startsWith('pending-') && (crew || /^[1-9]\d*$/.test(m.id))
            ? onReact
            : undefined;
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
            className="message-group"
            initial={entering && !reduced ? { opacity: 0, y: 10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            data-message-id={m.id ?? `pending-${i}`}
            data-message-role={m.role}
            data-message-phase={live ? 'live' : 'committed'}
            key={key}
          >
            {label && <p className="mb-4 text-center text-xs text-muted-foreground">{group}</p>}
            <Message
              id={m.id ?? `pending-${i}`}
              role={m.role === 'user' ? 'user' : crew ? 'member' : 'agent'}
              state={live ? 'live' : 'committed'}
              author={
                crew && m.role === 'assistant' ? (
                  m.author ? (
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="shrink-0 [&_.agent-avatar]:size-5">
                        {authorAvatar?.(m.author)}
                      </span>
                      {authorName(m.author)}
                    </span>
                  ) : live ? (
                    title
                  ) : (
                    'Crew member'
                  )
                ) : undefined
              }
              style={m.role === 'user' ? ownerBubbleStyle(ownerColor) : undefined}
              metadata={
                date && (
                  <time dateTime={date.toISOString()}>
                    {date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </time>
                )
              }
              reactions={
                m.reactions?.length ? (
                  <MessageReactions
                    id={m.id ?? ''}
                    reactions={m.reactions ?? []}
                    agentName={title}
                    onReact={react}
                  />
                ) : undefined
              }
              actions={
                (m.text.trim() || m.files?.length) && (
                  <>
                    {onReact && m.id && (
                      <ReactionPicker
                        id={m.id}
                        reactions={m.reactions ?? []}
                        onReact={onReact}
                        disabled={!react}
                      />
                    )}
                    {m.text.trim() && <CopyMessage text={m.text} />}
                  </>
                )
              }
            >
              {m.text.trim() &&
                (m.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{m.text}</p>
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
                  {documentFormat(file.name) && openDocument && client && sessionId && (
                    <IconButton
                      label={`View ${file.name}`}
                      icon={Eye}
                      onClick={() =>
                        openDocument({
                          name: file.name,
                          load: () => client.downloadFile(sessionId, file.id),
                        })
                      }
                    />
                  )}
                  <AttachmentTrigger
                    aria-label={`Download ${file.name}`}
                    onClick={() => onDownloadFile(file)}
                  />
                </Attachment>
              ))}
            </Message>
          </motion.div>
        );
      })}
      {footer}
      <ActivityLine
        key={conversationKey}
        active={!!conversationKey && running && !!activity}
        label={activity === 'Stop requested' ? 'Stopping' : activity}
      />
    </div>
  );
}
