import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './components/ui/table';
import {
  CodeBlock as CodeSurface,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockContent,
  CodeBlockActions,
  CodeBlockCopyButton,
} from './components/ui/code-block';
import { memo, useMemo, useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';
import type { BotBridgeClient } from '@hermes-client/protocol';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import { IconButton } from './components/ui/icon-button';
import {
  GeneratedFile,
  GeneratedImage,
  localReference,
  MessageMediaContext,
} from './chat/generated-media';
import type { MessageMedia } from './chat/generated-media';
import { remarkMedia } from './chat/media-markdown';

function CodeBlock({ value, language }: { value: string; language: string }) {
  return (
    <CodeSurface className="code-block">
      <CodeBlockHeader className="code-toolbar">
        <CodeBlockTitle>
          <span>{language || 'Text'}</span>
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton label="Copy code" value={value} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>{value}</CodeBlockContent>
    </CodeSurface>
  );
}

const components: Components = {
  table: ({ children }) => <Table scrollContainer={false}>{children}</Table>,
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children, style }) => <TableHead style={style}>{children}</TableHead>,
  td: ({ children, style }) => <TableCell style={style}>{children}</TableCell>,
  pre: ({ node }) => {
    const code = node?.children.find(
      (child) => child.type === 'element' && child.tagName === 'code',
    );
    const classes = code?.type === 'element' ? code.properties.className : [];
    const language = Array.isArray(classes)
      ? classes.find((value) => typeof value === 'string' && value.startsWith('language-'))
      : undefined;
    const value =
      code?.type === 'element'
        ? code.children.flatMap((child) => (child.type === 'text' ? [child.value] : [])).join('')
        : '';
    return (
      <CodeBlock language={typeof language === 'string' ? language.slice(9) : ''} value={value} />
    );
  },
  img: ({ src, alt }) =>
    src && localReference(src) ? (
      <GeneratedImage source={src} alt={alt ?? ''} />
    ) : src && /^https?:\/\//i.test(src) ? (
      <a href={src} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
        {alt || 'Open image'}
      </a>
    ) : (
      <span>Image unavailable</span>
    ),
  a: ({ href, children }) =>
    href && /^https?:\/\//i.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
        {children}
      </a>
    ) : href && localReference(href) ? (
      <GeneratedFile source={href}>{children}</GeneratedFile>
    ) : (
      <span>{children}</span>
    ),
};
const plugins = [remarkGfm, remarkMedia];
function transformUrl(url: string, key: string) {
  return key === 'src' || key === 'href'
    ? localReference(url)
      ? url
      : defaultUrlTransform(url)
    : defaultUrlTransform(url);
}

/** Images are authenticated canonical-chat reads, never direct requests to bot-supplied URLs. */
export const MessageBody = memo(function MessageBody({
  text,
  client,
  sessionId,
  rowId,
  conversationKey,
}: {
  text: string;
  client?: BotBridgeClient | undefined;
  sessionId?: string | undefined;
  rowId?: string | undefined;
  conversationKey?: string | undefined;
}) {
  const media = useMemo<MessageMedia | undefined>(() => {
    if (!client?.supportsGeneratedMedia || !sessionId) return;
    return rowId && /^[1-9]\d*$/.test(rowId) && Number.isSafeInteger(Number(rowId))
      ? {
          kind: 'saved',
          identity: `${conversationKey ?? sessionId}:${rowId}`,
          client,
          sessionId,
          rowId: Number(rowId),
        }
      : { kind: 'pending', identity: `${conversationKey ?? sessionId}:${rowId ?? ''}` };
  }, [client, sessionId, rowId, conversationKey]);
  return (
    <MessageMediaContext.Provider value={media}>
      <div className="message-body">
        <Markdown
          skipHtml
          remarkPlugins={plugins}
          components={components}
          urlTransform={transformUrl}
        >
          {text}
        </Markdown>
      </div>
    </MessageMediaContext.Provider>
  );
});

export function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      className="copy-message"
      label={copied ? 'Copied' : 'Copy message'}
      icon={copied ? Check : Copy}
      quiet
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    />
  );
}
