import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isInstalledWorkspace, useEdgeNavigation } from './edge-navigation';
import { usePanelRef } from 'react-resizable-panels';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../components/ui/resizable';

const storageKey = 'pebble-crew.sidebar-width';
function savedWidth() {
  try {
    const width = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(width) && width >= 280 && width <= 960) return width;
  } catch {
    // Browser storage is optional for layout preferences.
  }
  return 352;
}
function rememberWidth(width: number) {
  try {
    localStorage.setItem(storageKey, String(Math.round(width)));
  } catch {
    // Resizing remains available without persistence.
  }
}

export function WorkspacePanels({
  navigation,
  phone,
  navigationOpen = false,
  onCloseNavigation,
  onOpenNavigation,
  edgeNavigation = false,
  children,
}: {
  navigation: ReactNode;
  phone: boolean;
  navigationOpen?: boolean;
  onCloseNavigation?: () => void;
  onOpenNavigation?: () => void;
  edgeNavigation?: boolean;
  children: ReactNode;
}) {
  const [initialWidth] = useState(savedWidth);
  const width = useRef(initialWidth);
  const panel = usePanelRef();
  const page = useRef<HTMLDivElement>(null);
  const sidebarScroll = useRef(0);
  const installed = phone && isInstalledWorkspace();
  const nativeSidebarScroll = installed && navigationOpen;
  useEdgeNavigation(
    page,
    phone && edgeNavigation,
    navigationOpen ? onCloseNavigation : onOpenNavigation,
    navigationOpen ? 'to-chat' : 'to-list',
  );
  const closeNavigation = useRef(onCloseNavigation);
  closeNavigation.current = onCloseNavigation;
  useEffect(() => {
    if (!phone || !navigationOpen) return;
    const escape = (event: KeyboardEvent) => {
      const interactiveLayer = event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element &&
            node.matches('[role=dialog], [role=alertdialog], [role=menu], [role=listbox]'),
        );
      if (
        event.key === 'Escape' &&
        !interactiveLayer &&
        !document.querySelector(
          '[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open]',
        )
      ) {
        event.preventDefault();
        closeNavigation.current?.();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [phone, navigationOpen]);
  useLayoutEffect(() => {
    if (!phone) panel.current?.resize(savedWidth());
  }, [phone, panel]);
  useLayoutEffect(() => {
    if (!nativeSidebarScroll || !document.scrollingElement) return;
    const root = document.scrollingElement;
    root.scrollTop = sidebarScroll.current;
    const remember = () => {
      sidebarScroll.current = root.scrollTop;
    };
    document.addEventListener('scroll', remember, { passive: true });
    return () => {
      document.removeEventListener('scroll', remember);
      root.scrollTop = 0;
    };
  }, [nativeSidebarScroll]);
  return (
    <ResizablePanelGroup
      elementRef={page}
      orientation="horizontal"
      disabled={phone}
      className={phone ? 'pc-phone-pages' : undefined}
      data-navigation-open={phone ? navigationOpen : undefined}
      data-native-sidebar-scroll={nativeSidebarScroll || undefined}
      data-edge-navigation={(installed && edgeNavigation) || undefined}
      style={nativeSidebarScroll ? { height: 'auto', overflow: 'clip' } : undefined}
      onLayoutChanged={(_layout, meta) => {
        if (!phone && meta.isUserInteraction) rememberWidth(width.current);
      }}
    >
      <ResizablePanel
        id="navigation-panel"
        panelRef={panel}
        disabled={phone}
        style={phone ? { display: 'contents' } : { overflow: 'clip' }}
        defaultSize={phone ? 0 : initialWidth}
        minSize={phone ? 0 : 280}
        maxSize={phone ? 0 : 960}
        onResize={(size) => {
          if (!phone) width.current = size.inPixels;
        }}
        groupResizeBehavior="preserve-pixel-size"
      >
        <aside
          className={phone ? 'pc-mobile-navigation outline-none' : 'pc-rail sidebar'}
          role={phone ? 'region' : 'complementary'}
          tabIndex={phone ? -1 : undefined}
          aria-label={phone ? 'navigation' : 'Pebbles and crews'}
          aria-hidden={phone ? !navigationOpen : undefined}
          inert={phone && !navigationOpen}
        >
          {navigation}
        </aside>
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize sidebar"
        disabled={phone}
        className="z-10 hidden bg-transparent transition-colors after:w-3 hover:bg-border focus-visible:bg-border md:flex"
        onDoubleClick={() => {
          panel.current?.resize(352);
          rememberWidth(352);
        }}
      />
      <ResizablePanel
        id="conversation-panel"
        minSize={phone ? 0 : 360}
        className={phone ? 'pc-mobile-conversation' : 'flex min-h-0 min-w-0'}
        style={{ overflow: 'clip' }}
        aria-hidden={phone ? navigationOpen : undefined}
        inert={phone && navigationOpen}
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
