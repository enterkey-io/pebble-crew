import { useId } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemMedia } from '../components/ui/item';

export function ConversationIdentity({
  title,
  description,
  media,
  expanded,
  disabled,
  onClick,
}: {
  title: string;
  description?: string | undefined;
  media?: ReactNode;
  expanded: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const id = useId();
  return (
    <Item
      asChild
      className="pc-chat-identity chat-title w-auto min-w-0 flex-nowrap gap-2.5 border-0 py-1.5 pr-2.5 pl-0 text-left max-md:rounded-full max-md:bg-secondary/60 max-md:px-3"
    >
      <button
        type="button"
        aria-labelledby={`${id}-title ${description ? `${id}-role ` : ''}${id}-action`}
        aria-expanded={expanded}
        aria-controls="pebble-details"
        disabled={disabled}
        onClick={onClick}
      >
        {media && (
          <ItemMedia className="group-has-data-[slot=item-description]/item:self-center group-has-data-[slot=item-description]/item:translate-y-0">
            {media}
          </ItemMedia>
        )}
        <ItemContent className="gap-0 max-md:flex-row max-md:items-baseline max-md:gap-1 max-md:overflow-hidden">
          <ItemTitle id={`${id}-title`} className="max-md:shrink-0">
            <h1 className="text-[15px] leading-5 font-medium max-md:text-base">{title}</h1>
          </ItemTitle>{' '}
          {description && (
            <>
              <span
                aria-hidden="true"
                className="hidden shrink-0 text-muted-foreground max-md:inline"
              >
                ·
              </span>
              <ItemDescription
                id={`${id}-role`}
                className="text-xs leading-[18px] max-md:line-clamp-none max-md:truncate max-md:text-[length:var(--text-meta)]"
              >
                {description}
              </ItemDescription>
            </>
          )}{' '}
          <span id={`${id}-action`} className="sr-only">
            {expanded ? 'Hide details' : 'Show details'}
          </span>
        </ItemContent>
        <ChevronRight className={`pc-details-chevron ${expanded ? 'is-open' : ''}`} aria-hidden />
      </button>
    </Item>
  );
}
