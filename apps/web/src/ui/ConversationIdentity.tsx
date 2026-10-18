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
      className="pc-chat-identity chat-title w-auto min-w-0 flex-nowrap gap-2.5 border-0 py-1.5 pr-2.5 pl-0 text-left"
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
        <ItemContent className="gap-0">
          <ItemTitle id={`${id}-title`}>
            <h1 className="text-[15px] leading-5 font-medium">{title}</h1>
          </ItemTitle>{' '}
          {description && (
            <ItemDescription id={`${id}-role`} className="text-xs leading-[18px]">
              {description}
            </ItemDescription>
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
