import type { WorkspaceBot } from '@hermes-client/protocol';
import { AgentAvatar } from './AgentAvatar';
import { Button } from './components/ui/button';
import { LoadingBar } from './components/ui/loading-bar';

export function StartupScreen({
  mainPebble,
  error,
  onRetry,
}: {
  mainPebble?: Pick<WorkspaceBot, 'id' | 'appearance'> | undefined;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <main className="owner-entry">
      <div className="startup-progress">
        <div className="startup-pebble" aria-hidden="true">
          <AgentAvatar
            id={mainPebble?.id ?? 'startup'}
            look={{
              kind: 'shape',
              shape: mainPebble?.appearance.shape ?? 'pebble',
              color: mainPebble?.appearance.color ?? 'iris',
            }}
            orchestrator={!!mainPebble}
            large
          />
        </div>
        <LoadingBar active label="Opening Pebble Crew" />
        {error && (
          <div className="startup-error">
            <p role="alert">{error}</p>
            {onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
