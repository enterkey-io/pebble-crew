import type { WorkspaceBot } from '@hermes-client/protocol';
import { AgentAvatar } from './AgentAvatar';
import { Button } from './components/ui/button';

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
        <div className="startup-pebble-stage" role="progressbar" aria-label="Opening Pebble Crew">
          {mainPebble && (
            <div className="startup-pebble" key={mainPebble.id} aria-hidden="true">
              <AgentAvatar
                id={mainPebble.id}
                look={{
                  kind: 'shape',
                  shape: mainPebble.appearance.shape,
                  color: mainPebble.appearance.color,
                }}
                mood="welcoming"
                large
              />
            </div>
          )}
        </div>
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
