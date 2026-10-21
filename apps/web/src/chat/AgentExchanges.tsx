import { useEffect, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { safeError } from '@hermes-client/core';
import { ExchangeDomain } from '@hermes-client/protocol';
import type { BotBridgeClient, Exchange, ExchangeReference } from '@hermes-client/protocol';
import type { ReactNode } from 'react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import { Message } from '../components/ai-elements/message';
import { MessageBody } from '../MessageBody';
import { useOverlayHistory } from '../ui/overlay-history';

export function useAgentExchanges(
  client: BotBridgeClient | undefined,
  identity: string | undefined,
  face: (profile: string) => ReactNode,
) {
  const [snapshot, setSnapshot] = useState<{ identity: string; references: ExchangeReference[] }>();
  const [opened, setOpened] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!client || !identity || !client.supportsExchanges) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const references = await new ExchangeDomain(client).references(identity);
        if (active) setSnapshot({ identity, references });
      } catch {
        /* Keep verified references mounted through transport recovery. */
      }
      if (active) timer = setTimeout(() => void load(), 3000);
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, identity, revision]);
  const references = snapshot && snapshot.identity === identity ? snapshot.references : [];
  const cards = references.map((ref) => ({
    id: 'exchange:' + ref.id,
    createdAt: ref.createdAt,
    content: (
      <div className="my-3 flex justify-center" data-exchange-reference={ref.id}>
        <Button
          variant="quiet"
          size="sm"
          className="gap-1.5 px-1 text-xs font-normal text-muted-foreground"
          onClick={() => setOpened(ref.id)}
        >
          <MessagesSquare className="size-3.5" aria-hidden="true" />
          {ref.count} {ref.count === 1 ? 'message' : 'messages'} with
          <span aria-hidden="true" className="[&_.agent-avatar]:size-4">
            {face(ref.peer.profile)}
          </span>
          {ref.peer.name}
        </Button>
      </div>
    ),
  }));
  return {
    cards,
    suppressedTools: new Set(
      references.flatMap((ref) =>
        ref.toolReceipts.map((r) => JSON.stringify([r.callId, r.timestamp])),
      ),
    ),
    refresh: () => setRevision((r) => r + 1),
    viewer: client ? (
      <ExchangeViewer
        client={client}
        id={opened}
        onClose={() => setOpened(undefined)}
        face={face}
      />
    ) : null,
  };
}
function ExchangeViewer({
  client,
  id,
  onClose,
  face,
}: {
  client: BotBridgeClient;
  id: string | undefined;
  onClose: () => void;
  face: (profile: string) => ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Exchange>();
  const [error, setError] = useState('');
  useOverlayHistory(!!id, onClose);
  useEffect(() => {
    if (!id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setError('');
    const load = async () => {
      try {
        const value = await new ExchangeDomain(client).read(id);
        if (active) {
          setSnapshot(value);
          setError('');
        }
      } catch (error) {
        if (active) setError(safeError(error).message);
      }
      if (active) timer = setTimeout(() => void load(), 2000);
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, id]);
  const value = snapshot?.id === id ? snapshot : undefined;
  return (
    <Dialog
      open={!!id}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="content">
        <DialogHeader>
          <DialogTitle>
            {value?.participants.map((p) => p.name).join(' and ') ?? 'Agent conversation'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Private conversation between your agents
          </DialogDescription>
        </DialogHeader>
        <div
          className="min-h-0 overflow-y-auto overscroll-contain px-1"
          aria-label="Agent conversation"
          aria-busy={!value && !error}
        >
          {!value && !error && (
            <div
              className="h-0.5 w-full animate-pulse rounded bg-muted-foreground/30"
              role="progressbar"
              aria-label="Loading conversation"
            />
          )}
          {error && (
            <p role="alert" className="py-2 text-sm text-muted-foreground">
              {error}
            </p>
          )}
          {value?.messages.map((m) => {
            const author = value.participants.find((p) => p.id === m.author)!;
            return (
              <div className="mb-4" key={m.id} data-exchange-message={m.id}>
                <Message
                  id={m.id}
                  role="member"
                  state="committed"
                  author={
                    <span className="flex items-center gap-2">
                      <span className="[&_.agent-avatar]:size-5" aria-hidden="true">
                        {face(author.profile)}
                      </span>
                      {author.name}
                    </span>
                  }
                  metadata={new Date(m.createdAt).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                >
                  <MessageBody text={m.text} />
                </Message>
              </div>
            );
          })}
          {value?.state === 'uncertain' && (
            <p className="text-xs text-muted-foreground">
              Delivery could not be confirmed. It will not be sent twice.
            </p>
          )}
          {value?.state === 'failed' && (
            <p className="text-xs text-muted-foreground">The last delivery failed.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
