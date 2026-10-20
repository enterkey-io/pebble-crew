import { useCallback, useRef, useState } from 'react';
import type { WorkspaceBot } from '@hermes-client/protocol';
import { Command, CommandItem, CommandList } from '../components/ui/command';

export function useMentionSuggestions({
  value,
  caret,
  bots,
  onChoose,
}: {
  value: string;
  caret: number;
  bots: WorkspaceBot[];
  onChoose: (value: string, caret: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [listId, setListId] = useState<string>();
  const options = useRef(new Map<string, string>());
  const receiveList = useCallback((node: HTMLDivElement | null) => setListId(node?.id), []);
  const query = /(?:^|[\s(])@([\w-]*)$/.exec(value.slice(0, caret))?.[1]?.toLowerCase();
  const items =
    query !== undefined && dismissed !== value
      ? bots.filter(
          (b) =>
            b.enrolled &&
            b.available !== false &&
            (b.handle.toLowerCase().startsWith(query) || b.name.toLowerCase().includes(query)),
        )
      : [];
  const active = items[index % (items.length || 1)];
  function choose(handle: string) {
    const start = value.lastIndexOf('@', caret - 1);
    onChoose(
      value.slice(0, start) + '@' + handle + ' ' + value.slice(caret),
      start + handle.length + 2,
    );
    setIndex(0);
  }
  return {
    items,
    active,
    receiveList,
    options,
    choose,
    inputProps: {
      'aria-autocomplete': 'list' as const,
      'aria-controls': items.length ? listId : undefined,
      'aria-activedescendant': items.length ? options.current.get(active?.id ?? '') : undefined,
    },
    key(key: string) {
      if (!items.length) return false;
      if (key === 'Escape') {
        setDismissed(value);
        return true;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        setIndex((i) => (i + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
        return true;
      }
      if (key === 'Enter' || key === 'Tab') {
        if (active) choose(active.handle);
        return true;
      }
      return false;
    },
  };
}

export function MentionSuggestions({
  suggestions,
  className,
}: {
  suggestions: ReturnType<typeof useMentionSuggestions>;
  className?: string;
}) {
  if (!suggestions.items.length) return null;
  return (
    <Command
      label="Mention a Pebble"
      shouldFilter={false}
      value={suggestions.active?.handle ?? ''}
      className={`h-auto rounded-xl border p-1 shadow-md ${className ?? ''}`}
    >
      <CommandList ref={suggestions.receiveList} label="Mention a Pebble" className="max-h-40">
        {suggestions.items.map((bot) => (
          <CommandItem
            key={bot.id}
            value={bot.handle}
            ref={(node) => {
              if (node) suggestions.options.current.set(bot.id, node.id);
              else suggestions.options.current.delete(bot.id);
            }}
            onMouseDown={(event) => event.preventDefault()}
            onSelect={() => suggestions.choose(bot.handle)}
            className="min-h-11 justify-between gap-3 px-3"
          >
            <span className="min-w-0 truncate">{bot.name}</span>
            <span className="text-muted-foreground">@{bot.handle}</span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
