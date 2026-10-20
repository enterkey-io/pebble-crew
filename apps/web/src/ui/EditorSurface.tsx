import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';

/** Geometry only. Feature reducers retain drafts, conflicts and submission ownership. */
export function EditorSurface({
  header,
  navigation,
  children,
  footer,
  className,
  bodyClassName,
  ...props
}: ComponentProps<'section'> & {
  header: ReactNode;
  navigation?: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section
      {...props}
      data-slot="editor-surface"
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-4', className)}
    >
      <div data-slot="editor-header" className="shrink-0">
        {header}
      </div>
      {navigation && (
        <div data-slot="editor-navigation" className="shrink-0">
          {navigation}
        </div>
      )}
      <div
        data-slot="editor-body"
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain',
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer && (
        <div data-slot="editor-footer" className="flex shrink-0 items-center justify-end gap-2">
          {footer}
        </div>
      )}
    </section>
  );
}
export function TabbedEditor({
  tabs,
  value,
  onChange,
  children,
  ...props
}: Omit<ComponentProps<typeof EditorSurface>, 'navigation' | 'bodyClassName' | 'onChange'> & {
  tabs: readonly { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Tabs value={value} onValueChange={onChange} className="ui-tabs-root min-h-0 flex-1 gap-0">
      <EditorSurface
        {...props}
        bodyClassName="contents"
        navigation={
          <TabsList variant="line">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      >
        <TabsContent value={value} className="ui-tab-panel">
          {children}
        </TabsContent>
      </EditorSurface>
    </Tabs>
  );
}
