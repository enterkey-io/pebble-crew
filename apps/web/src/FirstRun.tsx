import { Label } from './components/ui/label';
import { Form } from './components/ui/form';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { useEffect, useRef, useState } from 'react';
import { normalizeEndpoint, safeError } from '@hermes-client/core';
import { pairBrowser } from '@hermes-client/protocol';
import release from '../../../release.json';

export function FirstRun({
  onConnect,
}: {
  onConnect: (endpoint: string, credential: string) => Promise<void>;
}) {
  const [view, setView] = useState<'home' | 'connect'>('home');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const installUrl = `https://raw.githubusercontent.com/${release.repository}/${release.tag}/docs/AGENT_INSTALL.md`;
  const agentMessage = `Please install the Pebble Crew plugin following ${installUrl}. Preserve my Hermes agents and data, set up a supervised service with the guide’s security checks, and give me the private web address and first-use setup link.`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/connection.json', {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const settings: unknown = await response.json();
        if (
          settings &&
          typeof settings === 'object' &&
          'bridgeUrl' in settings &&
          typeof settings.bridgeUrl === 'string'
        ) {
          const endpoint = normalizeEndpoint(settings.bridgeUrl, import.meta.env.DEV);
          setView('connect');
          setAddress(endpoint.baseUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, []);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError('Clipboard access is unavailable. Select and copy the message below.');
    }
  }
  async function pair() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError('');
    setBusy(true);
    setCode('');
    try {
      const endpoint = normalizeEndpoint(address, import.meta.env.DEV);
      const credential = await pairBrowser(endpoint, controller.signal, setCode);
      controller.signal.throwIfAborted();
      await onConnect(endpoint.baseUrl, credential);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          `${safeError(error).message} Check that your device can reach the Hermes connection address, that this web app is allowed by the integration, and that browser local-network access is permitted if requested. Your Hermes agent can check these settings.`,
        );
    } finally {
      if (active.current === controller) {
        setBusy(false);
        setCode('');
      }
    }
  }
  function cancel() {
    active.current?.abort();
    active.current = undefined;
    setBusy(false);
    setCode('');
    setError('');
  }

  return (
    <main className="first-run">
      <header className="first-header">
        <a href="/" className="wordmark">
          Pebble Crew
        </a>
      </header>
      {view === 'home' ? (
        <section className="first-hero">
          <h1>Install Pebble Crew</h1>
          <p>
            Ask your Hermes agent to install the plugin. They’ll give you your app’s private
            address.
          </p>
          <div className="first-actions">
            <Button onClick={() => void copy(agentMessage)}>
              {copied ? 'Copied' : 'Copy install instructions'}
            </Button>
            <Button variant="secondary" asChild>
              <a href="/install">Installation guide</a>
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setView('connect');
              setError('');
            }}
          >
            Connect an existing bridge
          </Button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      ) : (
        <section className="pair-card">
          <Button
            variant="secondary"
            className="back-button"
            onClick={() => {
              cancel();
              setView('home');
            }}
          >
            ← Back
          </Button>

          <h1>{code ? 'Approve this browser.' : 'Connect your Hermes.'}</h1>
          {!code && (
            <>
              <p>
                Use the Hermes connection address your agent gave you. This web app stays here; your
                browser talks directly to Hermes. You do not need to paste an API key.
              </p>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void pair();
                }}
              >
                <>
                  <Label layout="stacked" htmlFor="workspace-url">
                    Hermes connection address
                  </Label>
                  <Input
                    id="workspace-url"
                    type="url"
                    required
                    placeholder="https://your-hermes-connection.example"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    disabled={busy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </>
                <Button variant="default" className="primary" disabled={busy}>
                  {busy ? 'Contacting your Hermes…' : 'Request browser access'}
                </Button>
              </Form>
            </>
          )}
          {code && (
            <>
              <p>
                Send this code to your own Hermes agent and ask it to approve this browser. It
                expires in five minutes.
              </p>
              <p>
                Approve access from <strong>{location.origin}</strong> to <strong>{address}</strong>
                .
              </p>
              <output className="pair-code" aria-label="Browser approval code">
                {code}
              </output>
              <p className="approval-message">
                “Please approve browser code <strong>{code}</strong> for my private workspace.”
              </p>
              <p className="pair-wait" role="status">
                Waiting for your Hermes agent to approve…
              </p>
              <details>
                <summary>What will my agent do?</summary>
                <p>On your Hermes host, it runs:</p>
                <code>
                  hermes bot-web approve {code} --app-origin {location.origin}
                </code>
                <p>Only approve a code that you see in your own browser.</p>
              </details>
              <Button variant="secondary" onClick={cancel}>
                Cancel request
              </Button>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="pair-privacy">
            <h2>What gets shared?</h2>
            <p>
              The approval request and bot traffic go directly to your Hermes connection, not to
              this website’s server. The address is not saved here. Browser access expires after one
              hour and stays in this tab’s memory. No account or credential vault is created on our
              systems.
            </p>
            <p>
              A web app’s code can access its own browser session. Self hosting lets you choose and
              control the build you use.
            </p>
          </div>
        </section>
      )}
      <footer className="first-footer">
        <span>Uses Hermes’s native Bot Mode · Preview {release.version}</span>
        <a href={`https://github.com/${release.repository}`}>Source on GitHub</a>
        <a href="/install">Read the agent installation guide</a>
      </footer>
    </main>
  );
}
