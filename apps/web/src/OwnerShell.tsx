import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { useEffect, useState } from 'react';
import { App } from './App';
import { useAppViewport } from './ui/viewport';
import { StartupScreen } from './StartupScreen';

export interface OwnerConnection {
  ticket: () => Promise<{ ticket: string; bridgeUrl: string }>;
  logout: () => Promise<void>;
}
export class OwnerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function ownerRequest(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw new OwnerRequestError(
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : 'Please sign in.',
      response.status,
    );
  return value;
}
export function OwnerShell({ setupProof = '' }: { setupProof?: string } = {}) {
  useAppViewport();
  const [mode, setMode] = useState<
    'loading' | 'preview' | 'setup' | 'login' | 'ready' | 'unavailable'
  >('loading');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [proof, setProof] = useState(setupProof);
  const usingSetupLink = Boolean(setupProof);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function check() {
    try {
      const r = await fetch('/api/instance/status', {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      if (r.status === 404) {
        setMode('preview');
        return;
      }
      if (!r.ok) throw new Error();
      const status = (await r.json()) as { setupRequired: boolean };
      if (status.setupRequired) {
        setMode('setup');
        return;
      }
      const session = await ownerRequest('/api/auth/get-session');
      setMode(session ? 'ready' : 'login');
    } catch {
      setMode('unavailable');
    }
  }
  useEffect(() => {
    void check();
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'setup') {
        if (password !== confirmation) throw new Error('The passwords don’t match.');
        await ownerRequest('/api/bootstrap', { username, password, proof });
        setProof('');
      }
      await ownerRequest('/api/auth/sign-in/username', { username, password, rememberMe: true });
      setPassword('');
      setConfirmation('');
      setMode('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }
  if (mode === 'preview') return <App />;
  if (mode === 'loading') return <StartupScreen />;
  if (mode === 'ready')
    return (
      <App
        owner={{
          ticket: async () => {
            try {
              return (await ownerRequest('/api/hermes/ticket', {})) as {
                ticket: string;
                bridgeUrl: string;
              };
            } catch (error) {
              if (error instanceof OwnerRequestError && error.status === 401) setMode('login');
              throw error;
            }
          },
          logout: async () => {
            await ownerRequest('/api/auth/sign-out', {});
            setMode('login');
          },
        }}
      />
    );
  return (
    <main className="owner-entry">
      <div className="owner-card">
        <h1>
          {mode === 'setup'
            ? 'Create your login'
            : mode === 'unavailable'
              ? 'Unable to connect'
              : 'Sign in'}
        </h1>
        {mode === 'unavailable' ? (
          <>
            <p>The app isn’t responding. Try again in a moment.</p>
            <Button variant="secondary" onClick={() => void check()}>
              Try again
            </Button>
          </>
        ) : (
          <>
            {mode === 'setup' && !usingSetupLink && (
              <p>Open your private setup link to continue.</p>
            )}
            <form onSubmit={(e) => void submit(e)}>
              {mode === 'setup' && !usingSetupLink && (
                <label>
                  Private setup code
                  <Input
                    required
                    autoComplete="off"
                    value={proof}
                    onChange={(e) => setProof(e.target.value.trim())}
                  />
                </label>
              )}
              <label>
                Username
                <Input
                  required
                  autoComplete="username"
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9_]+"
                  title="3–32 letters, numbers or underscores"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label>
                Password
                <Input
                  required
                  type="password"
                  autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                  minLength={mode === 'setup' ? 12 : 1}
                  {...(mode === 'setup' ? { placeholder: 'At least 12 characters' } : {})}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {mode === 'setup' && (
                <label>
                  Confirm password
                  <Input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <Button variant="default" className="primary" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'setup' ? 'Create login' : 'Sign in'}
              </Button>
            </form>
            {mode === 'login' && (
              <details>
                <summary>Forgot your password?</summary>
                <p>Ask your Hermes agent to reset your login.</p>
              </details>
            )}
          </>
        )}
      </div>
    </main>
  );
}
