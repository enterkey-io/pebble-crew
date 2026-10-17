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
          <button className="startup-sign-out" onClick={onSignOut}>
            Sign out
          </button>
        )}
        {error && (
          <div className="startup-error">
            <p role="alert">{error}</p>
            {onRetry && <button onClick={onRetry}>Try again</button>}
          </div>
        )}
      </div>
    </main>
  );
}
