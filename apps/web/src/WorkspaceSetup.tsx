import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { useEffect, useState } from 'react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { decodeWorkspaceSnapshot } from '@hermes-client/protocol';
import type { Appearance, WorkspaceSnapshot as WorkspaceState } from '@hermes-client/protocol';
import { AvatarChooser } from './AgentAvatar';
export function WorkspaceSetup({
  client,
  onComplete,
}: {
  client: BotBridgeClient;
  onComplete: (state: WorkspaceState, profile: string, welcome: boolean) => void;
}) {
  const [profile, setProfile] = useState('');
  const [agentName, setAgentName] = useState('');
  const [handle, setHandle] = useState('hermes');
  const [revision, setRevision] = useState(0);
  const [look, setLook] = useState<Appearance>({ kind: 'shape', shape: 'pebble', color: 'iris' });
  const [photo, setPhoto] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(true);
  useEffect(() => {
    let live = true;
    void client
      .invoke('workspace.detect_primary', {})
      .then((data) => {
        if (!live) return;
        const d = data as {
          complete: boolean;
          profile: string;
          revision: number;
          bot: { name?: string; handle: string; appearance: Appearance };
        };
        if (!d.complete)
          throw new Error(
            'Your installer must confirm the primary Hermes profile before setup can continue. No agent has been changed.',
          );
        setProfile(d.profile);
        const name = (typeof d.bot.name === 'string' && d.bot.name.trim()) || d.profile;
        setAgentName(name === 'default' ? '' : name);
        setRevision(d.revision);
        setHandle(d.bot.handle);
        // First use starts with an animated avatar, even when Hermes supplies a stock image.
        // Existing photos stay available in the picker and are never removed by this choice.
        setLook({ kind: 'shape', shape: 'pebble', color: 'iris' });
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : 'Could not detect your primary agent.');
      });
    return () => {
      live = false;
    };
  }, [client]);
  async function finish(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = decodeWorkspaceSnapshot(
        await client.invoke('workspace.initialize', {
          profile,
          handle,
          appearance: look,
          photo: look.kind === 'photo' ? photo || null : null,
          expected_revision: revision,
        }),
      );
      onComplete(data, profile, welcome);
    } catch {
      setError(
        'Setup could not be confirmed. Refresh to check the saved state before trying again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-setup">
      <div className="setup-intro">
        <h1>{agentName ? `Customize ${agentName}` : 'Your existing Hermes agent'}</h1>
        <p>
          {agentName
            ? 'Your existing primary Hermes agent.'
            : 'Your primary agent. Choose a handle and avatar.'}
        </p>
      </div>
      <form onSubmit={(e) => void finish(e)}>
        <label>
          Handle
          <span className="handle-input">
            <span>@</span>
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              required
              minLength={2}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
            />
          </span>
        </label>
        <AvatarChooser
          look={look}
          onChange={setLook}
          photo={photo}
          onPhoto={setPhoto}
          client={client}
          profile={profile}
          onBusyChange={setPhotoBusy}
        />
        <label className="welcome-choice">
          <input type="checkbox" checked={welcome} onChange={(e) => setWelcome(e.target.checked)} />
          Send an introduction
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Button variant="default" className="primary" disabled={busy || photoBusy || !profile}>
          {busy ? 'Saving…' : 'Start chatting'}
        </Button>
      </form>
    </section>
  );
}
