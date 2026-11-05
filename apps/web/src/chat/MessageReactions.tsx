import { useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../components/ui/dropdown-menu';
import type { MessageReaction } from './reactions';
import { reactionChoices } from './reactions';

export type ReactionAction = (id: string, emoji: string | null) => Promise<void>;

export function ReactionPicker({
  id,
  reactions,
  onReact,
  disabled = false,
}: {
  id: string;
  reactions: MessageReaction[];
  onReact: ReactionAction;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  const own = reactions.find((r) => r.author === 'user')?.emoji;
  const button = (
    <Button
      ref={trigger}
      variant="ghost"
      size="icon-sm"
      aria-label="React to message"
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled || pending}
      onClick={
        open
          ? undefined
          : () => {
              keyboard.current = false;
              setOpen(true);
            }
      }
      onKeyDown={
        open
          ? undefined
          : (event) => {
              if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                keyboard.current = true;
                setOpen(true);
              }
            }
      }
    >
      <SmilePlus />
    </Button>
  );
  if (!open)
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>React to message</TooltipContent>
      </Tooltip>
    );
  return (
    <DropdownMenu modal={false} open onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent
        ref={menu}
        container={trigger.current?.closest('main') ?? null}
        onFocusCapture={(event) => {
          if (keyboard.current && event.target === event.currentTarget) {
            keyboard.current = false;
            requestAnimationFrame(() =>
              menu.current
                ?.querySelector<HTMLElement>('[role="menuitem"]')
                ?.focus({ preventScroll: true }),
            );
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
        }}
        onInteractOutside={(event) => {
          const target = event.detail.originalEvent.target;
          if (target instanceof Node && trigger.current?.contains(target)) event.preventDefault();
        }}
        className="pc-reaction-picker"
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Message reactions"
      >
        {reactionChoices.map(({ emoji, label }) => (
          <DropdownMenuItem
            key={emoji}
            aria-label={`React with ${label.toLowerCase()}`}
            data-selected={own === emoji}
            onSelect={() => {
              setPending(true);
              void onReact(id, own === emoji ? null : emoji).finally(() => setPending(false));
            }}
          >
            <span aria-hidden="true">{emoji}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MessageReactions({
  id,
  reactions,
  agentName,
  onReact,
}: {
  id: string;
  reactions: MessageReaction[];
  agentName: string;
  onReact?: ReactionAction | undefined;
}) {
  const [pending, setPending] = useState(false);
  if (!reactions.length) return null;
  return (
    <>
      {[...new Set(reactions.map((r) => r.emoji))].map((emoji) => {
        const matching = reactions.filter((r) => r.emoji === emoji);
        const own = matching.some((r) => r.author === 'user');
        const who = matching
          .map((r) => (r.author === 'user' ? 'You' : (r.name ?? agentName)))
          .join(' and ');
        return (
          <Button
            key={emoji}
            type="button"
            variant="quiet"
            size="icon-sm"
            className="w-auto min-w-8 gap-1 px-0 text-lg"
            aria-label={`${emoji} · ${who}`}
            aria-pressed={own}
            aria-disabled={!onReact || pending}
            title={who}
            onClick={() => {
              if (!onReact || pending) return;
              setPending(true);
              void onReact(id, own ? null : emoji).finally(() => setPending(false));
            }}
          >
            <span aria-hidden="true">{emoji}</span>
            {matching.length > 1 && (
              <small className="text-xs text-muted-foreground" aria-hidden="true">
                {matching.length}
              </small>
            )}
          </Button>
        );
      })}
    </>
  );
}
