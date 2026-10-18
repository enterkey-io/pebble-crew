import { Alert, AlertDescription } from '../components/ui/alert';
import { Typography } from '../components/ui/typography';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { X, MoreHorizontal } from 'lucide-react';
import { IconButton } from '../components/ui/icon-button';
import { Button } from '../components/ui/button';
import { Tabs as RootTabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../components/ui/dropdown-menu';

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <Alert variant={error ? 'destructive' : 'default'} role={error ? 'alert' : 'status'}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
export function PageHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <header className="page-header">
      <div>
        <Typography as="h1">{title}</Typography>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <IconButton label={`Close ${title}`} icon={X} onClick={onClose} />
    </header>
  );
}
export function FormSection({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="form-section">
      <div className="form-section-heading">
        <Typography as="h2">{title}</Typography>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}
export function Tabs({
  tabs,
  value,
  onChange,
  children,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <RootTabs className="ui-tabs-root" value={value} onValueChange={onChange}>
      <TabsList variant="line">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent className="ui-tab-panel" value={value}>
        {children}
      </TabsContent>
    </RootTabs>
  );
}
export type MenuItem = {
  label: string;
  icon?: LucideIcon;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  items?: MenuItem[];
};
function Items({ items }: { items: MenuItem[] }) {
  if (!items.length) return <EmptyMenuItem />;
  return items.map((item) =>
    item.items ? (
      <DropdownMenuSub key={item.label}>
        <DropdownMenuSubTrigger>{item.label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="border-0">
          <Items items={item.items} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : item.checked != null ? (
      <DropdownMenuCheckboxItem
        key={item.label}
        checked={item.checked}
        disabled={item.disabled ?? false}
        onCheckedChange={item.action}
      >
        {item.label}
      </DropdownMenuCheckboxItem>
    ) : (
      <DropdownMenuItem
        key={item.label}
        disabled={item.disabled ?? false}
        variant={item.danger ? 'destructive' : 'default'}
        onSelect={item.action}
      >
        {item.icon && <item.icon aria-hidden="true" />}
        {item.label}
      </DropdownMenuItem>
    ),
  );
}
export function EmptyMenuItem() {
  return (
    <DropdownMenuItem disabled className="opacity-50">
      None
    </DropdownMenuItem>
  );
}
export function Menu({
  label,
  children,
  items,
  className = '',
  disabled = false,
  placement,
}: {
  label: string;
  children?: ReactNode;
  items: MenuItem[];
  className?: string;
  disabled?: boolean;
  placement: 'row-actions' | 'toolbar' | 'composer' | 'account';
}) {
  return (
    <span className={`menu-anchor ${className}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="quiet" size="icon-sm" aria-label={label} disabled={disabled}>
            {children ?? <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          aria-label={label}
          align={placement === 'composer' || placement === 'account' ? 'start' : 'end'}
          side={placement === 'composer' || placement === 'account' ? 'top' : 'bottom'}
          data-placement={placement}
          className="border-0"
          collisionPadding={12}
        >
          <Items items={items} />
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
