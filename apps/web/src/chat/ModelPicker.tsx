import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import type { SessionClient } from '@hermes-client/protocol';
import { ClientError } from '@hermes-client/core';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { LoadingBar } from '../components/ui/loading-bar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command';

type Provider = { id: string; name: string; models: string[] };
type Catalog = { model: string; provider: string; providers: Provider[] };

function catalog(value: unknown): Catalog {
  const data = value as Partial<Catalog> | null;
  if (
    !data ||
    typeof data.model !== 'string' ||
    typeof data.provider !== 'string' ||
    !Array.isArray(data.providers) ||
    data.providers.length > 80 ||
    data.providers.some(
      (p) =>
        typeof p?.id !== 'string' ||
        typeof p.name !== 'string' ||
        !Array.isArray(p.models) ||
        p.models.length > 3000 ||
        p.models.some((m) => typeof m !== 'string'),
    )
  )
    throw new ClientError('INVALID_RESPONSE');
  return { model: data.model, provider: data.provider, providers: data.providers };
}

export function ModelPicker({
  client,
  sessionId,
  onClose,
  onResult,
}: {
  client: SessionClient;
  sessionId: string;
  onClose: () => void;
  onResult: (message: string) => void;
}) {
  const [data, setData] = useState<Catalog>();
  const [provider, setProvider] = useState<Provider>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<{ model: string; message: string }>();
  useEffect(() => {
    let current = true;
    setError('');
    void client
      .invoke('chat.model.options', { session_id: sessionId })
      .then(catalog)
      .then(
        (result) => {
          if (current) setData(result);
        },
        () => {
          if (current) setError('Hermes couldn’t load the model list.');
        },
      );
    return () => {
      current = false;
    };
  }, [client, sessionId, retry]);
  async function choose(model: string, confirm = false) {
    if (!provider || pending) return;
    setPending(true);
    setError('');
    try {
      const result = (await client.invoke('chat.model.select', {
        session_id: sessionId,
        provider: provider.id,
        model,
        confirm,
      })) as { value?: unknown; confirm_required?: unknown; message?: unknown; deferred?: unknown };
      if (result.confirm_required === true) {
        setConfirmation({
          model,
          message: typeof result.message === 'string' ? result.message : '',
        });
        return;
      }
      if (typeof result.value !== 'string' || !result.value)
        throw new ClientError('INVALID_RESPONSE');
      onResult(
        result.deferred === true
          ? `Hermes will switch to ${result.value} on the next turn.`
          : `Switched to ${result.value}.`,
      );
      onClose();
    } catch {
      setError('Hermes couldn’t confirm the model switch.');
    } finally {
      setPending(false);
    }
  }
  const currentProvider =
    data?.providers.find((item) => item.id === data.provider)?.name ?? data?.provider;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent size="content" className="gap-3 p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>{provider ? provider.name : 'Choose a model'}</DialogTitle>
          <DialogDescription>
            {data?.model
              ? `Current: ${data.model}${currentProvider ? ` · ${currentProvider}` : ''}`
              : 'Models for this conversation'}
          </DialogDescription>
        </DialogHeader>
        {provider && !confirmation && (
          <Button
            type="button"
            variant="quiet"
            className="self-start"
            onClick={() => setProvider(undefined)}
            disabled={pending}
          >
            <ChevronLeft aria-hidden="true" /> Providers
          </Button>
        )}
        {!data && !error && <LoadingBar active label="Loading models" />}
        {error && (
          <Alert>
            <AlertDescription>
              {error}
              {!data && (
                <Button variant="link" onClick={() => setRetry((value) => value + 1)}>
                  Retry
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {confirmation ? (
          <div className="grid gap-3">
            <p>{confirmation.message || 'Hermes requires confirmation for this model.'}</p>
            <div className="flex justify-end gap-2">
              <Button variant="quiet" disabled={pending} onClick={() => setConfirmation(undefined)}>
                Cancel
              </Button>
              <Button disabled={pending} onClick={() => void choose(confirmation.model, true)}>
                Switch model
              </Button>
            </div>
          </div>
        ) : (
          data && (
            <Command
              key={provider?.id ?? 'providers'}
              aria-label={provider ? 'Models' : 'Providers'}
            >
              <CommandInput placeholder={provider ? 'Search models' : 'Search providers'} />
              <CommandList className="max-h-[min(45dvh,360px)]">
                <CommandEmpty>
                  {provider ? 'No models found' : 'No configured providers found'}
                </CommandEmpty>
                {provider
                  ? provider.models.map((model) => (
                      <CommandItem
                        key={model}
                        value={model}
                        disabled={pending}
                        onSelect={() => void choose(model)}
                      >
                        <span className="min-w-0 flex-1 truncate">{model}</span>
                        {provider.id === data.provider && model === data.model && (
                          <Check aria-label="Current model" />
                        )}
                      </CommandItem>
                    ))
                  : data.providers.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.name + ' ' + item.id}
                        onSelect={() => setProvider(item)}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <ChevronRight aria-hidden="true" />
                      </CommandItem>
                    ))}
              </CommandList>
            </Command>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
