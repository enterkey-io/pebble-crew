import type { ReactNode } from 'react';
import type { WorkspaceBot } from '@hermes-client/protocol';
import { Button } from '../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';

export function MessageMention({ bot, children }: { bot: WorkspaceBot; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="message-mention inline select-text h-auto min-h-0 min-w-0 rounded px-0.5 py-0 text-[length:inherit] leading-[inherit] whitespace-normal underline decoration-dotted underline-offset-2 pointer-coarse:min-h-0 pointer-coarse:min-w-0"
          data-mention-id={bot.id}
          aria-label={`View ${bot.name}'s profile`}
        >
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={`${bot.name}'s profile`} className="max-w-[calc(100vw-2rem)] p-3">
        <p className="font-medium">{bot.name}</p>
        <p className="text-muted-foreground">@{bot.handle}</p>
        {bot.role.title && <p>{bot.role.title}</p>}
        {bot.description && (
          <p className="whitespace-pre-wrap wrap-break-word">{bot.description}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
