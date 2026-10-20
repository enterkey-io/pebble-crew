import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
  children,
}: {
  navigation: ReactNode;
  phone: boolean;
  children: ReactNode;
}) {
  const [initialWidth] = useState(savedWidth);
  const width = useRef(initialWidth);
  const panel = usePanelRef();
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      disabled={phone}
      onLayoutChanged={(_layout, meta) => {
        if (!phone && meta.isUserInteraction) rememberWidth(width.current);
      }}
    >
      <ResizablePanel
        id="navigation-panel"
        panelRef={panel}
        className="hidden md:flex"
        defaultSize={phone ? 0 : initialWidth}
        minSize={phone ? 0 : 280}
        maxSize={phone ? 0 : 960}
        onResize={(size) => {
          if (!phone) width.current = size.inPixels;
        }}
        groupResizeBehavior="preserve-pixel-size"
      >
        <aside className="pc-rail sidebar" aria-label="Pebbles and crews">
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
        className="flex min-h-0 min-w-0"
        style={{ overflow: 'clip' }}
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
