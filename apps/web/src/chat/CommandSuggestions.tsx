import { ConversationDomain } from '@hermes-client/protocol';
import type { CommandSuggestion, BotBridgeClient } from '@hermes-client/protocol';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Command, CommandItem, CommandList } from '../components/ui/command';
import { LoadingBar } from '../components/ui/loading-bar';

export type CommandSuggestionsHandle = { key: (key: string) => boolean };
type Catalog = {
  client: BotBridgeClient;
  sessionId: string;
  prefix: string;
  items: CommandSuggestion[];
  start: number;
};
export const CommandSuggestions = forwardRef<
  CommandSuggestionsHandle,
  {
    client: BotBridgeClient;
    enabled: boolean;
    sessionId: string;
    text: string;
    onChoose: (text: string, execute: boolean) => void;
  }
>(function CommandSuggestions({ client, enabled, sessionId, text, onChoose }, ref) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [selection, setSelection] = useState({ text: '', index: 0 });
  const [dismissed, setDismissed] = useState('');
  const visible = enabled && text.startsWith('/') && !text.includes('\n') && dismissed !== text;
  const prefix = text.includes(' ') ? text.slice(0, text.indexOf(' ') + 1) : '/';
  const current =
    catalog?.client === client && catalog.sessionId === sessionId && catalog.prefix === prefix
      ? catalog
      : undefined;
  useEffect(() => {
    if (!visible || current) return;
    let active = true;
    void new ConversationDomain(client)
      .commands(sessionId, prefix)
      .then((value) => {
        if (active)
          setCatalog({ client, sessionId, prefix, items: value.items, start: value.replaceFrom });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, sessionId, prefix, visible, current]);
  const query = text.slice(current?.start ?? 1).toLowerCase();
  const items =
    current?.items.filter(
      (item) =>
        item.text.toLowerCase().startsWith(query) ||
        item.label.toLowerCase().replace(/^\//, '').startsWith(query),
    ) ?? [];
  const index = selection.text === text ? selection.index % (items.length || 1) : 0;
  function choose(item: CommandSuggestion, execute: boolean) {
    const chosen = text.slice(0, current?.start ?? 1) + item.text;
    const needsArgument = chosen.trim() === '/model';
    const next = chosen.trimEnd() + (needsArgument || !execute ? ' ' : '');
    if (!needsArgument) setDismissed(next);
    onChoose(next, execute && !needsArgument);
  }
  useImperativeHandle(ref, () => ({
    key(key) {
      if (!visible) return false;
      if (key === 'Escape') {
        setDismissed(text);
        return true;
      }
      if (!items.length) return false;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        setSelection({
          text,
          index: (index + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length,
        });
        return true;
      }
      if (key === 'Tab' || key === 'Enter') {
        const item = items[index];
        if (item) choose(item, key === 'Enter');
        return true;
      }
      return false;
    },
  }));
  if (!visible || (current && !items.length)) return null;
  return (
    <Command
      shouldFilter={false}
      value={items[index]?.text ?? ''}
      className="pc-composer-width mb-2 h-auto rounded-xl border p-1 shadow-md"
      aria-label="Hermes commands"
    >
      {!current && <LoadingBar active label="Loading commands" />}
      <CommandList className="max-h-48" aria-label="Hermes commands">
        {items.map((item) => (
          <CommandItem
            key={item.text}
            value={item.text}
            onMouseDown={(event) => event.preventDefault()}
            onSelect={() => choose(item, true)}
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
