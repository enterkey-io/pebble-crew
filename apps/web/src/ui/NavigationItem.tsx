import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Badge } from '../components/ui/badge';
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from '../components/ui/item';

export function NavigationItem({
  media,
  title,
  label,
  description,
  action,
  className,
  density = 'normal',
  ...props
}: Omit<ComponentProps<'button'>, 'title'> & {
  density?: 'normal' | 'compact';
  media?: ReactNode;
  title: string;
  label?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Item
      asChild
      size="xs"
      className={cn(
        'min-w-0 flex-nowrap gap-2.5 rounded-lg text-left hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50',
        density === 'compact' ? 'min-h-11 py-1' : 'min-h-16',
        className,
      )}
    >
      <button type="button" {...props}>
        {media && (
          <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
            {media}
          </ItemMedia>
        )}
        <ItemContent className="gap-1">
          <ItemTitle className="w-full min-w-0 gap-1.5">
            <strong className="min-w-0 max-w-full shrink-0 truncate font-medium">{title}</strong>{' '}
            {label && (
              <Badge
                variant="secondary"
                className="block min-w-0 shrink truncate rounded px-1 py-0 text-xs font-normal"
              >
                {label}
              </Badge>
            )}
          </ItemTitle>{' '}
          {description && (
            <ItemDescription className="line-clamp-1 text-xs">{description}</ItemDescription>
          )}
        </ItemContent>
        {action && (
          <ItemActions className="text-muted-foreground [&>svg]:size-4">{action}</ItemActions>
        )}
      </button>
    </Item>
  );
}
