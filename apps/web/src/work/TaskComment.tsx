import { useCallback, useId, useRef, useState } from 'react';
import type { WorkspaceSnapshot } from '@hermes-client/protocol';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Command, CommandItem, CommandList } from '../components/ui/command';

export function TaskComment({
  value,
  onChange,
  workspace,
}: {
  value: string;
  onChange: (value: string) => void;
  workspace: WorkspaceSnapshot;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useId();
  const [listId, setListId] = useState<string>();
  const options = useRef(new Map<string, string>());
  const receiveList = useCallback((node: HTMLDivElement | null) => setListId(node?.id), []);
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const match = /(?:^|\s)@([\w-]*)$/.exec(value.slice(0, caret));
  const query = match?.[1]?.toLowerCase();
  const items =
    query !== undefined && dismissed !== value
      ? workspace.bots.filter(
          (b) =>
            b.enrolled &&
            b.available !== false &&
            (b.handle.toLowerCase().startsWith(query) || b.name.toLowerCase().includes(query)),
        )
      : [];
  function choose(handle: string) {
    const start = value.lastIndexOf('@', caret - 1);
    const next = value.slice(0, start) + '@' + handle + ' ' + value.slice(caret);
    const position = start + handle.length + 2;
    onChange(next);
    setCaret(position);
    setIndex(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  }
  return (
    <div className="grid gap-2">
      <Label htmlFor={list + '-input'}>Comment</Label>
      <Textarea
        ref={input}
        id={list + '-input'}
        sizing="fixed"
        required
        value={value}
        aria-autocomplete="list"
        aria-controls={items.length ? listId : undefined}
        aria-activedescendant={options.current.get(items[index]?.id ?? '')}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setIndex(0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (!items.length || event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setDismissed(value);
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex(
              (i) => (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length,
            );
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            const item = items[index];
            if (item) choose(item.handle);
          }
        }}
      />
      {!!items.length && (
        <Command
          label="Mention a Pebble"
          shouldFilter={false}
          value={items[index]?.handle ?? ''}
          className="h-auto rounded-lg border p-1"
        >
          <CommandList ref={receiveList} label="Mention a Pebble" className="max-h-40">
            {items.map((bot) => (
              <CommandItem
                ref={(node) => {
                  if (node) options.current.set(bot.id, node.id);
                  else options.current.delete(bot.id);
                }}
                key={bot.id}
                value={bot.handle}
                onMouseDown={(event) => event.preventDefault()}
                onSelect={() => choose(bot.handle)}
                className="justify-between"
              >
                <span>{bot.name}</span>
                <span className="text-muted-foreground">@{bot.handle}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      )}
    </div>
  );
}
