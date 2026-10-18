import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { initializeAppearance } from './appearance-bootstrap';
import type { AppearanceMode } from './appearance-bootstrap';

const AppearanceContext = createContext<{
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
} | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setState] = useState(initializeAppearance);
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const updateSystem = () => initializeAppearance(mode);
    const updateStorage = (event: StorageEvent) => {
      if (event.key === 'pebble-crew.appearance' || event.key === null)
        setState(initializeAppearance());
    };
    system.addEventListener('change', updateSystem);
    window.addEventListener('storage', updateStorage);
    return () => {
      system.removeEventListener('change', updateSystem);
      window.removeEventListener('storage', updateStorage);
    };
  }, [mode]);
  return (
    <AppearanceContext value={{ mode, setMode: (next) => setState(initializeAppearance(next)) }}>
      {children}
    </AppearanceContext>
  );
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('Appearance settings require AppearanceProvider.');
  return value;
}
