import { usePageTitle } from './ui/page-title';
import { Label } from './components/ui/label';
import { Form } from './components/ui/form';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { useEffect, useState } from 'react';
import { App } from './App';
import { useAppViewport } from './ui/viewport';
import { StartupScreen } from './StartupScreen';
import { ownerRequest, OwnerRequestError } from './owner-request';
import { OwnerPhotoProvider, sessionPhoto } from './OwnerPhoto';
import { clearSavedDrafts } from './chat/drafts';
import { Disclosure } from './components/ui/disclosure';

export interface OwnerConnection {
  ticket: (
    signal?: AbortSignal,
  ) => Promise<{ ticket: string; bridgeUrl: string; expiresIn?: number }>;
  logout: () => Promise<void>;
}
export function OwnerShell({ setupProof = '' }: { setupProof?: string } = {}) {
  useAppViewport();
  const [mode, setMode] = useState<
    'loading' | 'preview' | 'setup' | 'login' | 'ready' | 'unavailable'
  >('loading');
  usePageTitle(
    mode === 'ready' || mode === 'preview'
      ? undefined
      : mode === 'setup'
        ? 'Create admin login'
        : mode === 'login'
          ? 'Sign in'
          : '',
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [proof, setProof] = useState(setupProof);
  const usingSetupLink = Boolean(setupProof);
  const [error, setError] = useState('');
  const [image, setImage] = useState<string | null>(null);
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
      setImage(sessionPhoto(session));
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
      const signedIn = await ownerRequest('/api/auth/sign-in/username', {
        username,
        password,
        rememberMe: true,
      });
      setImage(sessionPhoto(signedIn));
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
      <OwnerPhotoProvider image={image} onUnauthorized={() => setMode('login')}>
        <App
          owner={{
            ticket: async (signal) => {
              try {
                return (await ownerRequest('/api/hermes/ticket', {}, signal)) as {
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
              clearSavedDrafts();
              setMode('login');
            },
          }}
        />
      </OwnerPhotoProvider>
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
            <Form onSubmit={(e) => void submit(e)}>
              {mode === 'setup' && !usingSetupLink && (
                <Label layout="stacked">
                  Private setup code
                  <Input
                    required
                    autoComplete="off"
                    value={proof}
                    onChange={(e) => setProof(e.target.value.trim())}
                  />
                </Label>
              )}
              <Label layout="stacked">
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
              </Label>
              <Label layout="stacked">
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
              </Label>
              {mode === 'setup' && (
                <Label layout="stacked">
                  Confirm password
                  <Input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </Label>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <Button variant="default" className="primary" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'setup' ? 'Create login' : 'Sign in'}
              </Button>
            </Form>
            {mode === 'login' && (
              <Disclosure title="Forgot your password?">
                <p>Ask your Hermes agent to reset your login.</p>
              </Disclosure>
            )}
          </>
        )}
      </div>
    </main>
  );
}
