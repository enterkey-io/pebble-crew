import { useEffect, useReducer, useRef, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { LoadingBar } from '../components/ui/loading-bar';
import { Notice } from '../ui/primitives';
import { permissions, probe, authFlow, keySaved, policyLabel, toolTitle } from './model';
import type { Connection, Permission, Tool, AuthFlow, Remote } from './model';
import { emptyPolicyEdit, policyDirty, reducePolicyEdit } from './edit-session';

export function ConnectionDetail({
  client,
  profile,
  connection,
  onDirtyChange,
  onChanged,
}: {
  client: BotBridgeClient;
  profile: string;
  connection: Connection;
  onDirtyChange: (dirty: boolean) => void;
  onChanged: () => void;
}) {
  const name = connection.name;
  const [access, setAccess] = useState<Remote<Permission>>({ kind: 'loading' });
  const [edit, dispatch] = useReducer(reducePolicyEdit, emptyPolicyEdit);
  const draft = edit.draft;
  const [tools, setTools] = useState<Tool[]>();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolQuery, setToolQuery] = useState('');
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checked, setChecked] = useState<'unknown' | 'connected' | 'failed'>('unknown');
  const [flow, setFlow] = useState<AuthFlow>();
  const [retry, setRetry] = useState(0);
  const keyInput = useRef<HTMLInputElement>(null);
  const permission = edit.kind === 'ready' ? edit.remote : undefined;
  const conflict = edit.kind === 'ready' && edit.conflict;
  const toolsDirty = policyDirty(edit);
  const dirty = !!key || toolsDirty;
  useEffect(() => {
    if (keyOpen) keyInput.current?.focus({ preventScroll: true });
  }, [keyOpen]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    let live = true;
    setAccess({ kind: 'loading' });
    void client
      .invoke('connections.permissions', { profile, name })
      .then((value) => {
        const next = permissions(value);
        if (live) {
          setAccess({ kind: 'ready', value: next });
          dispatch({ type: 'receive', value: next });
        }
      })
      .catch(() => {
        if (live) setAccess({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [client, profile, name, retry]);
  async function refreshAccess() {
    const next = permissions(await client.invoke('connections.permissions', { profile, name }));
    setAccess({ kind: 'ready', value: next });
    dispatch({ type: 'receive', value: next });
  }
  useEffect(() => {
    if (!flow || flow.state === 'approved' || flow.state === 'error') return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = authFlow(await client.invoke('connections.auth_status', { id: flow!.id }));
        if (!live) return;
        setFlow(next);
        if (next.state === 'approved') {
          const nextAccess = permissions(
            await client.invoke('connections.permissions', { profile, name }),
          );
          if (!live) return;
          setAccess({ kind: 'ready', value: nextAccess });
          dispatch({ type: 'receive', value: nextAccess });
          setTools(undefined);
          setNotice('Signed in.');
          onChanged();
        } else if (next.state === 'error') setError('Sign-in was not completed. Try again.');
        else timer = setTimeout(() => void poll(), 1500);
      } catch {
        if (live) {
          setFlow(undefined);
          setError('Sign-in could not be confirmed. Try again.');
        }
      }
    }
    timer = setTimeout(() => void poll(), 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, profile, name, flow?.id, onChanged]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch {
      setError('Change not confirmed. Check the connection before retrying.');
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    const result = probe(await client.invoke('connections.test', { profile, name }));
    setChecked(result.kind === 'connected' ? 'connected' : 'failed');
    if (result.kind === 'connected') setTools(result.tools);
    else
      setError(
        result.signIn
          ? 'Sign in to check this connection.'
          : 'Could not connect. Check the service and try again.',
      );
  }
  const authorizing = flow?.state === 'waiting' || flow?.state === 'authorize';
  const status = !connection.enabled
    ? 'Disabled'
    : checked === 'connected'
      ? 'Connected'
      : checked === 'failed'
        ? 'Needs attention'
        : connection.needsSignIn && flow?.state !== 'approved'
          ? 'Sign-in needed'
          : 'Configured';
  return (
    <div className="connection-detail" aria-label={`${name} connection`}>
      <header className="connection-detail-header">
        <h2>{name}</h2>
        <span className="connection-status-text" data-connected={checked === 'connected'}>
          {status}
        </span>
      </header>
      <LoadingBar
        active={busy || access.kind === 'loading' || !!authorizing}
        label="Updating connection"
      />
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {conflict && (
        <Notice>
          Tool access changed elsewhere.
          <Button variant="link" onClick={() => dispatch({ type: 'discard' })}>
            Use saved settings
          </Button>
          <Button variant="link" onClick={() => dispatch({ type: 'keep' })}>
            Keep my changes
          </Button>
        </Notice>
      )}
      <section className="connection-section" aria-labelledby="connection-access-title">
        <h3 id="connection-access-title">Connection</h3>
        <div className="connection-detail-actions">
          {permission?.oauth && !authorizing && (
            <Button
              variant={
                connection.needsSignIn && flow?.state !== 'approved' ? 'default' : 'secondary'
              }
              disabled={busy || dirty}
              onClick={() =>
                void run(async () => {
                  setFlow(
                    authFlow(await client.invoke('connections.auth_start', { profile, name })),
                  );
                })
              }
            >
              Sign in
            </Button>
          )}
          <Button variant="quiet" disabled={busy || !!authorizing} onClick={() => void run(check)}>
            Check connection
          </Button>
        </div>
        {authorizing && (
          <div className="connection-sign-in">
            {flow.state === 'authorize' && flow.url && (
              <Button asChild>
                <a href={flow.url} target="_blank" rel="noopener noreferrer">
                  Continue sign-in <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            )}
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await client.invoke('connections.auth_cancel', { id: flow.id });
                  setFlow(undefined);
                })
              }
            >
              Cancel sign-in
            </Button>
          </div>
        )}
        {access.kind === 'error' && (
          <Notice error>
            Connection details unavailable.{' '}
            <Button variant="link" onClick={() => setRetry((v) => v + 1)}>
              Retry
            </Button>
          </Notice>
        )}
        {permission?.bearer && (
          <div className="connection-credential">
            {!keyOpen ? (
              <Button variant="quiet" onClick={() => setKeyOpen(true)}>
                Add or replace API key
              </Button>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    keySaved(
                      await client.invoke('connections.set_key', {
                        profile,
                        name,
                        value: key,
                        expected: permission.fingerprint,
                      }),
                    );
                    setKey('');
                    setKeyOpen(false);
                    await refreshAccess();
                    onChanged();
                    setChecked('unknown');
                    setNotice('API key saved.');
                  });
                }}
              >
                <label htmlFor="connection-api-key">API key</label>
                <Input
                  ref={keyInput}
                  id="connection-api-key"
                  type="password"
                  autoComplete="off"
                  required
                  maxLength={4096}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                />
                <div className="connection-detail-actions">
                  <Button disabled={busy || !key}>Save key</Button>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={busy}
                    onClick={() => {
                      setKey('');
                      setKeyOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>
      {permission && (
        <section className="connection-section">
          <button
            className="connection-disclosure"
            disabled={busy || !!authorizing}
            aria-expanded={toolsOpen}
            aria-controls="connection-tools"
            onClick={() => {
              setToolsOpen(!toolsOpen);
              if (!toolsOpen && !tools) void run(check);
            }}
          >
            <span>
              <strong>Tool access</strong>
              <small>{policyLabel(permission.policy)}</small>
            </span>
            <ChevronDown aria-hidden="true" data-open={toolsOpen} />
          </button>
          {toolsOpen && (
            <div id="connection-tools" className="connection-tools">
              {tools && draft.kind === 'native' && (
                <>
                  <p>Keep Hermes settings, or choose an exact list.</p>
                  <Button
                    variant="secondary"
                    disabled={busy || !!authorizing}
                    onClick={() =>
                      dispatch({ type: 'change', value: { kind: 'custom', names: [] } })
                    }
                  >
                    Choose tools
                  </Button>
                </>
              )}
              {tools && draft.kind === 'custom' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (conflict) return;
                    const submitted = draft;
                    void run(async () => {
                      const next = permissions(
                        await client.invoke('connections.permissions', {
                          profile,
                          name,
                          tools: draft.names,
                          expected: permission.fingerprint,
                        }),
                      );
                      setAccess({ kind: 'ready', value: next });
                      dispatch({ type: 'saved', value: next, submitted });
                      setNotice('Tool access saved. Applies when this pebble restarts.');
                    });
                  }}
                >
                  {tools.length > 8 && (
                    <Input
                      aria-label="Search tools"
                      placeholder="Search tools"
                      value={toolQuery}
                      onChange={(event) => setToolQuery(event.target.value)}
                    />
                  )}
                  <fieldset aria-label={`${name} tools`}>
                    {[
                      ...tools,
                      ...draft.names
                        .filter((n) => !tools.some((t) => t.name === n))
                        .map((n) => ({ name: n, description: 'Unavailable in the latest check' })),
                    ]
                      .filter((tool) =>
                        `${tool.name} ${tool.description}`
                          .toLowerCase()
                          .includes(toolQuery.toLowerCase()),
                      )
                      .map((tool, index) => (
                        <label
                          className="connection-tool"
                          key={tool.name}
                          htmlFor={`connection-tool-${index}`}
                        >
                          <Checkbox
                            id={`connection-tool-${index}`}
                            aria-label={tool.name}
                            disabled={busy || !!authorizing}
                            checked={draft.names.includes(tool.name)}
                            onCheckedChange={(selected) =>
                              dispatch({
                                type: 'change',
                                value: {
                                  kind: 'custom',
                                  names:
                                    selected === true
                                      ? [...draft.names, tool.name]
                                      : draft.names.filter((n) => n !== tool.name),
                                },
                              })
                            }
                          />
                          <span>
                            <strong title={tool.name}>{toolTitle(tool.name)}</strong>
                            {tool.description && <small>{tool.description}</small>}
                          </span>
                        </label>
                      ))}
                  </fieldset>
                  {!tools.length && !draft.names.length && <p>No tools available.</p>}
                  <div className="connection-detail-actions connection-tool-save">
                    <Button disabled={busy || !!authorizing || !toolsDirty || conflict}>
                      Save changes
                    </Button>
                  </div>
                </form>
              )}
              {!tools && !busy && (
                <Button variant="secondary" onClick={() => void run(check)}>
                  Retry
                </Button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
