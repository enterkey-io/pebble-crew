import type { ReactNode } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { IconButton } from '../components/ui/icon-button';

export function WorkHeader({
  title,
  description,
  onNavigate,
  children,
}: {
  title: string;
  description?: string | undefined;
  onNavigate: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="pc-work-header">
      <IconButton
        quiet
        className="md:hidden"
        label="Toggle navigation"
        icon={PanelLeftOpen}
        onClick={onNavigate}
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {description && <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </header>
  );
}
