import { Button } from './components/ui/button';
import { LoadingBar } from './components/ui/loading-bar';

export function StartupScreen({
  onSignOut,
  error,
  onRetry,
}: {
  onSignOut?: (() => void) | undefined;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <main className="owner-entry">
      <div className="startup-progress">
        <LoadingBar active label="Opening Pebble Crew" />
        {onSignOut && (
          <Button variant="quiet" size="sm" className="startup-sign-out" onClick={onSignOut}>
            Sign out
          </Button>
        )}
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
