import { createContext, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, MessageSquare, X } from 'lucide-react';
import type { TranscriptCard } from './presentation';
import { Button } from '../components/ui/button';

export const AttentionVisible = createContext(true);

export type AttentionNavigation = {
  selection: { id: string; focus: string | undefined } | undefined;
  order: Map<string, number>;
};

/** Presentation-only dismissal; no decision or server request is submitted. */
export function useAttentionDocks() {
  const [minimized, setMinimized] = useState<Record<string, readonly string[]>>({});
  return {
    isMinimized: (scope: string, items: readonly TranscriptCard[]) =>
      items.length > 0 && items.every((item) => minimized[scope]?.includes(item.id)),
    minimize: (scope: string, items: readonly TranscriptCard[]) =>
      setMinimized((previous) => ({ ...previous, [scope]: items.map((item) => item.id) })),
    expand: (scope: string) => setMinimized((previous) => ({ ...previous, [scope]: [] })),
    focus: (id: string) =>
      setMinimized((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([, ids]) => !ids.includes('request:' + id)),
        ),
      ),
  };
}

/** Fixed input surface; hidden siblings stay mounted so unfinished forms survive navigation. */
export function ConversationAttention({
  items,
  focusId,
  navigation,
  minimized = false,
  onMinimize,
  onExpand,
}: {
  items: TranscriptCard[];
  focusId?: string | undefined;
  navigation?: AttentionNavigation | undefined;
  minimized?: boolean;
  onMinimize?: (() => void) | undefined;
  onExpand?: (() => void) | undefined;
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
      className="pc-composer-width min-w-0 text-card-foreground"
    >
      {minimized ? (
        <Button
          variant="quiet"
          className="w-full justify-start gap-2 rounded-xl bg-muted px-4"
          onClick={onExpand}
          aria-label={`${items.length === 1 ? 'Request pending' : `${items.length} requests pending`}. Review pending requests`}
        >
          <MessageSquare className="size-4" />
          <span>{items.length === 1 ? 'Request pending' : `${items.length} requests pending`}</span>
          <ChevronUp className="ml-auto size-4" />
        </Button>
      ) : (
        <div className="flex items-center justify-end gap-2 px-2 pt-1 pb-1 text-xs text-muted-foreground">
          {items.length > 1 && (
            <>
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
            </>
          )}
          {onMinimize && (
            <Button
              variant="quiet"
              size="icon-sm"
              aria-label="Minimize request"
              onClick={onMinimize}
            >
              <X />
            </Button>
          )}
        </div>
      )}
      <div
        hidden={minimized}
        inert={minimized}
        className="max-h-[min(66dvh,36rem)] overflow-y-auto overscroll-contain px-1 pb-1"
      >
        {items.map((item, i) => (
          <div key={item.id} hidden={i !== index} inert={i !== index} data-attention-id={item.id}>
            <AttentionVisible.Provider value={!minimized && i === index}>
              {item.content}
            </AttentionVisible.Provider>
          </div>
        ))}
      </div>
    </section>
  );
}
