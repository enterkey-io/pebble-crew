import { createContext, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TranscriptCard } from './presentation';
import { Button } from '../components/ui/button';

export const AttentionVisible = createContext(true);

export type AttentionNavigation = {
  selection: { id: string; focus: string | undefined } | undefined;
  order: Map<string, number>;
};

/** Fixed input surface; hidden siblings stay mounted so unfinished forms survive navigation. */
export function ConversationAttention({
  items,
  focusId,
  navigation,
}: {
  items: TranscriptCard[];
  focusId?: string | undefined;
  navigation?: AttentionNavigation | undefined;
}) {
  const fallback = useRef<AttentionNavigation>({ selection: undefined, order: new Map() });
  const state = navigation ?? fallback.current;
  const [, render] = useState(0);
  const selected = state.selection;
  for (const item of items)
    if (!state.order.has(item.id)) state.order.set(item.id, state.order.size);
  items = items.slice().sort((a, b) => (state.order.get(a.id) ?? 0) - (state.order.get(b.id) ?? 0));
  function choose(id: string) {
    state.selection = { id, focus: focusId };
    render((n) => n + 1);
  }
  const requested = items.find((item) => item.id === 'request:' + focusId);
  const active =
    (requested && selected?.focus !== focusId ? requested.id : selected?.id) ?? items[0]?.id;
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === active),
  );
  if (!state.selection || (selected?.id && !items.some((item) => item.id === selected.id)))
    state.selection = { id: items[index]?.id ?? '', focus: focusId };
  if (!items.length) return null;
  return (
    <section
      role="region"
      aria-label="Waiting for your input"
      data-slot="conversation-attention"
      className="pc-composer-width min-w-0 rounded-2xl bg-card text-card-foreground shadow-sm"
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs text-muted-foreground">
        <span className="mr-auto">Your input</span>
        <span aria-live="polite" className="tabular-nums">
          {index + 1} of {items.length}
        </span>
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Previous request"
          disabled={index === 0}
          onClick={() => choose(items[index - 1]?.id ?? '')}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Next request"
          disabled={index === items.length - 1}
          onClick={() => choose(items[index + 1]?.id ?? '')}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="max-h-[min(66dvh,36rem)] overflow-y-auto overscroll-contain px-1 pb-1">
        {items.map((item, i) => (
          <div key={item.id} hidden={i !== index} inert={i !== index} data-attention-id={item.id}>
            <AttentionVisible.Provider value={i === index}>
              {item.content}
            </AttentionVisible.Provider>
          </div>
        ))}
      </div>
    </section>
  );
}
