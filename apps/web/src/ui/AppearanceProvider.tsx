import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { initializeAppearance, initializeChatBubbles } from './appearance-bootstrap';
import type { AppearanceMode, ChatBubbleMode } from '@hermes-client/protocol';

const AppearanceContext = createContext<{
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
  chatBubbles: ChatBubbleMode;
  setChatBubbles: (mode: ChatBubbleMode) => void;
} | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setState] = useState(initializeAppearance);
  const [chatBubbles, setBubbleState] = useState(initializeChatBubbles);
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const updateSystem = () => initializeAppearance(mode);
    const updateStorage = (event: StorageEvent) => {
      if (event.key === 'pebble-crew.appearance' || event.key === null)
        setState(initializeAppearance());
      if (event.key === 'pebble-crew.chat-bubbles' || event.key === null)
        setBubbleState(initializeChatBubbles());
    };
    system.addEventListener('change', updateSystem);
    window.addEventListener('storage', updateStorage);
    return () => {
      system.removeEventListener('change', updateSystem);
      window.removeEventListener('storage', updateStorage);
    };
  }, [mode]);
  const setMode = useCallback((next: AppearanceMode) => setState(initializeAppearance(next)), []);
  const setChatBubbles = useCallback(
    (next: ChatBubbleMode) => setBubbleState(initializeChatBubbles(next)),
    [],
  );
  return (
    <AppearanceContext
      value={{
        mode,
        setMode,
        chatBubbles,
        setChatBubbles,
      }}
    >
      {children}
    </AppearanceContext>
  );
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('Appearance settings require AppearanceProvider.');
  return value;
}
