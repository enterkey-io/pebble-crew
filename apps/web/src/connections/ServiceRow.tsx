import type { ReactNode } from 'react';
import { ChevronRight, Plug } from 'lucide-react';
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from '../components/ui/item';

export function ServiceRow({
  name,
  description,
  onOpen,
  children,
}: {
  name: string;
  description: string;
  onOpen?: () => void;
  children?: ReactNode;
}) {
  const content = (
    <>
      <ItemMedia
        variant="icon"
        className="group-has-data-[slot=item-description]/item:self-center group-has-data-[slot=item-description]/item:translate-y-0 text-muted-foreground"
      >
        <Plug aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="break-words">{name}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      {children && <ItemActions>{children}</ItemActions>}
    </>
  );
  const className = 'connection-row min-h-17 flex-nowrap rounded-xl text-left';
  return onOpen ? (
    <Item asChild className={`${className} transition-colors hover:bg-accent/50`}>
      <button type="button" data-connection-trigger={name} onClick={onOpen}>
        {content}
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </Item>
  ) : (
    <Item className={className}>{content}</Item>
  );
}
