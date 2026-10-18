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
  const trigger = useRef<HTMLButtonElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const own = reactions.find((r) => r.author === 'user')?.emoji;
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) setContainer(trigger.current?.closest('main') ?? null);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={trigger}
              variant="ghost"
              size="icon-sm"
              aria-label="React to message"
              disabled={disabled || pending}
            >
              <SmilePlus />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>React to message</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        container={container}
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
        const who = matching.map((r) => (r.author === 'user' ? 'You' : agentName)).join(' and ');
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
