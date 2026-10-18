import { createRoot } from 'react-dom/client';
import { OwnerShell } from './OwnerShell';
import { consumeSetupLink } from './setup-link';
import { registerPwa } from './pwa';
import './ui/theme.css';
import { TooltipProvider } from './components/ui/tooltip';
import { lazy, Suspense } from 'react';
import { LoadingBar } from './components/ui/loading-bar';

const SystemWorkbench =
  import.meta.env.DEV || import.meta.env.VITE_SYSTEM_WORKBENCH === '1'
    ? lazy(() => import('./ui-lab/SystemWorkbench'))
    : null;
const workbench = SystemWorkbench !== null && window.location.pathname === '/system';
const setupProof = workbench ? '' : consumeSetupLink(window.location, window.history);
if (!workbench) registerPwa();
createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    {workbench && SystemWorkbench ? (
      <Suspense fallback={<LoadingBar active />}>
        <SystemWorkbench />
      </Suspense>
    ) : (
      <OwnerShell setupProof={setupProof} />
    )}
  </TooltipProvider>,
);
