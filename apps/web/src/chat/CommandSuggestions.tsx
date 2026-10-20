import { ConversationDomain } from '@hermes-client/protocol';
import type { CommandSuggestion } from '@hermes-client/protocol';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { Command, CommandItem, CommandList } from '../components/ui/command';
import { LoadingBar } from '../components/ui/loading-bar';

type Suggestion = CommandSuggestion;
export type CommandSuggestionsHandle = { key: (key: string) => boolean };
export const CommandSuggestions = forwardRef<
  CommandSuggestionsHandle,
  {
    client: BotBridgeClient;
    enabled: boolean;
    sessionId: string;
    text: string;
    onChoose: (text: string) => void;
  }
>(function CommandSuggestions({ client, enabled, sessionId, text, onChoose }, ref) {
  const [items, setItems] = useState<Suggestion[]>([]),
    [index, setIndex] = useState(0);
  const [start, setStart] = useState(1),
    [loading, setLoading] = useState(false),
    [dismissed, setDismissed] = useState('');
  const visible = enabled && text.startsWith('/') && !text.includes('\n') && dismissed !== text;
  useEffect(() => {
    let current = true;
    setItems([]);
    setIndex(0);
    if (!visible) return;
    setLoading(true);
    const timer = setTimeout(() => {
      void new ConversationDomain(client)
        .commands(sessionId, text)
        .then((value) => {
          if (current) {
            setItems(value.items);
            setStart(value.replaceFrom);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 100);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, sessionId, text, visible]);
  const choose = (item: Suggestion) => {
    onChoose(text.slice(0, start) + item.text + ' ');
  };
  useImperativeHandle(ref, () => ({
    key(key) {
      if (!visible) return false;
      if (key === 'Escape') {
        setDismissed(text);
        return true;
      }
      if (!items.length) return false;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        setIndex((value) => (value + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
        return true;
      }
      if (key === 'Tab' || key === 'Enter') {
        const item = items[index];
        if (item) choose(item);
        return true;
      }
      return false;
    },
  }));
  if (!visible || (!loading && !items.length)) return null;
  return (
    <Command
      shouldFilter={false}
      value={items[index]?.text ?? ''}
      className="pc-composer-width mb-2 h-auto rounded-xl border p-1 shadow-md"
      aria-label="Hermes commands"
    >
      {loading && <LoadingBar active label="Loading commands" />}
      <CommandList className="max-h-48" aria-label="Hermes commands">
        {items.map((item) => (
          <CommandItem
            key={item.text}
            value={item.text}
            onSelect={() => choose(item)}
            className="flex items-start justify-between gap-3 px-3 py-2"
          >
            <span className="shrink-0 font-medium">{item.label}</span>
            <span className="min-w-0 text-right text-xs text-muted-foreground">
              {item.description}
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
});
