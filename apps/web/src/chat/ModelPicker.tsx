import { useEffect, useRef, useState } from 'react';
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
  DialogFooter,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command';
import {
  decodeModelGroupRules,
  groupOllamaProviders,
  selectionProvider,
  type ModelCatalog,
  type ModelProvider,
} from './model-groups';

type Provider = ModelProvider;
type Catalog = ModelCatalog;

function catalog(value: unknown): Catalog {
  const data = value as (Partial<Catalog> & { model_groups?: unknown }) | null;
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
  const rules = decodeModelGroupRules(data.model_groups);
  return {
    model: data.model,
    provider: data.provider,
    providers: data.providers,
    ...(rules ? { rules } : {}),
  };
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
  const surface = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const target = confirmation
      ? cancel.current
      : data && matchMedia('(pointer: fine)').matches
        ? search.current
        : surface.current;
    target?.focus({ preventScroll: true });
  }, [data, provider, confirmation]);
  useEffect(() => {
    let current = true;
    setError('');
    void client
      .invoke('chat.model.options', { session_id: sessionId })
      .then(catalog)
      .then(groupOllamaProviders)
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
        provider: selectionProvider(provider, model),
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
      <DialogContent
        ref={surface}
        size="content"
        className="gap-0 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          surface.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="px-5 pt-5 pb-2 pr-14 text-left">
          <DialogTitle>{provider ? provider.name : 'Choose a model'}</DialogTitle>
          <DialogDescription className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
            {data?.model
              ? `Current: ${data.model}${currentProvider ? ` · ${currentProvider}` : ''}`
              : 'Models for this conversation'}
          </DialogDescription>
        </DialogHeader>
        <div className="px-5">
          <LoadingBar active={pending} label="Updating model" />
        </div>
        {!data && !error && (
          <div className="px-5 pb-5">
            <LoadingBar active label="Loading models" />
          </div>
        )}
        {error && (
          <Alert className="mx-5 mb-4 w-auto">
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
          <>
            <Alert className="mx-5 mb-4 w-auto">
              <AlertDescription>
                {confirmation.message || 'Hermes requires confirmation for this model.'}
              </AlertDescription>
            </Alert>
            <DialogFooter className="px-5 pb-5">
              <Button
                ref={cancel}
                variant="quiet"
                disabled={pending}
                onClick={() => setConfirmation(undefined)}
              >
                Cancel
              </Button>
              <Button disabled={pending} onClick={() => void choose(confirmation.model, true)}>
                Switch model
              </Button>
            </DialogFooter>
          </>
        ) : (
          data && (
            <Command
              key={provider?.id ?? 'providers'}
              aria-label={provider ? 'Models' : 'Providers'}
              className="min-h-0 rounded-none bg-transparent **:data-[slot=command-input-wrapper]:shrink-0"
            >
              <CommandInput
                ref={search}
                variant="search"
                placeholder={provider ? 'Search models' : 'Search providers'}
              />
              <div className="flex h-10 shrink-0 items-center px-3">
                {provider ? (
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground"
                    onClick={() => setProvider(undefined)}
                    disabled={pending}
                  >
                    <ChevronLeft aria-hidden="true" /> Providers
                  </Button>
                ) : (
                  <span className="px-2 text-xs text-muted-foreground">Providers</span>
                )}
              </div>
              <CommandList className="min-h-0 max-h-[min(45dvh,360px)] scroll-py-2 px-2 pb-2">
                <CommandEmpty>
                  {provider ? 'No models found' : 'No configured providers found'}
                </CommandEmpty>
                {provider
                  ? provider.models.map((model) => (
                      <CommandItem
                        key={model}
                        value={model}
                        disabled={pending}
                        className="min-h-11 gap-3 rounded-lg px-3 py-3 text-sm pointer-coarse:min-h-12 pointer-coarse:text-base"
                        onSelect={() => void choose(model)}
                      >
                        <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">
                          {model}
                        </span>
                        {provider.id === data.provider && model === data.model && (
                          <Check aria-label="Current model" />
                        )}
                      </CommandItem>
                    ))
                  : data.providers.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.name + ' ' + item.id}
                        className="min-h-12 gap-3 rounded-lg px-3 py-3 text-sm pointer-coarse:text-base"
                        onSelect={() => setProvider(item)}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span
                          aria-hidden="true"
                          className="text-xs tabular-nums text-muted-foreground"
                        >
                          {item.models.length}
                        </span>
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
