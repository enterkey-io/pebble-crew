import type { ComponentProps, ComponentType } from 'react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

type IconButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'aria-label'> & {
  label: string;
  icon: ComponentType<{ className?: string }>;
  quiet?: boolean;
  tooltip?: boolean;
};

export function IconButton({
  label,
  icon: Glyph,
  quiet = false,
  tooltip = true,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      type="button"
      variant={quiet ? 'quiet' : variant}
      size={size}
      aria-label={label}
      {...props}
    >
      <Glyph />
    </Button>
  );
  return tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  ) : (
    button
  );
}
