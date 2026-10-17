import { useEffect, useReducer, useState } from 'react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { WorkspaceDomain } from '@hermes-client/protocol';
import type { WorkspaceBot, WorkspaceSnapshot as WorkspaceState } from '@hermes-client/protocol';
import {
  emptyProfile,
  profileValues,
  profileSession,
  profileReducer,
  profileDirty,
} from './profiles/edit-session';
import { profileWriteError } from './profiles/save-outcome';
import { ProfileConflicts } from './profiles/ProfileConflicts';
import {
  PebbleProfileFields,
  RoleBasics,
  RoleDetails,
  ReportingField,
} from './ui/pebble-profile-fields';
import { Button } from './components/ui/button';
import { LoadingBar } from './components/ui/loading-bar';
import { Notice } from './ui/primitives';
const refreshError = 'Could not refresh this profile. Your unsaved fields are still here.';
export function ExistingPebbleSetup({
  client,
  profile,
  state,
  onDone,
  onDirtyChange,
}: {
  client: BotBridgeClient;
  profile: string;
  state: WorkspaceState;
  onDone: (profile: string, introduce: boolean) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [bot, setBot] = useState<WorkspaceBot>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retired, setRetired] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [avatarBusy, setAvatarBusy] = useState(false),
    [introduce, setIntroduce] = useState(true);
  const [edit, dispatch] = useReducer(profileReducer, undefined, () =>
    profileSession(emptyProfile()),
  );
  const value = edit.draft,
    { role, manager } = value,
    revision = edit.revision;
  useEffect(() => {
    let live = true;
    void new WorkspaceDomain(client)
      .describeWorkspace()
      .then((next) => {
        const found = next.bots.find((b) => b.profile === profile && b.available !== false);
        if (!found) {
          if (live) {
            setRetired(true);
            setError('This agent is unavailable. Go back and refresh the list.');
          }
          return;
        }
        if (live) {
          setRetired(false);
          setError((error) => (error === refreshError ? '' : error));
          setBot(found);
          dispatch({
            type: 'receive',
            values: profileValues(found, next.orchestrator || '', true),
            identity: found.id,
            revision: next.revision,
          });
        }
      })
      .catch(() => {
        if (live) {
          setError(refreshError);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, profile, state.revision]);
  useEffect(() => {
    onDirtyChange(!!bot && profileDirty(edit));
    return () => onDirtyChange(false);
  }, [bot, edit, onDirtyChange]);
  async function add() {
    if (busy || !bot || retired || edit.retired || uncertain || edit.conflicts.length) return;
    setBusy(true);
    setError('');
    try {
      const result = await new WorkspaceDomain(client).onboardExisting({
        target: { profile, id: edit.identity! },
        name: value.name,
        handle: value.handle,
        appearance: value.appearance,
        photo: value.photo ? { kind: 'replace', data: value.photo } : { kind: 'preserve' },
        role,
        manager: profile === state.orchestrator ? null : manager || state.orchestrator,
        expectedRevision: revision,
      });
      if (result.kind !== 'confirmed') {
        setUncertain(result.kind === 'uncertain');
        setError(profileWriteError(result));
        return;
      }
      await onDone(profile, introduce);
    } catch {
      setError('Could not finish adding this agent. Reopen it to review the saved profile.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="profile-form"
      aria-label="Configure existing agent"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
      aria-busy={busy || loading}
    >
      <LoadingBar active={loading || busy} label={busy ? 'Adding agent' : 'Loading profile'} />
      <div className="profile-content" inert={busy}>
        {error && <Notice error>{error}</Notice>}
        {edit.retired && (
          <Notice error>This agent was replaced. Reopen the agent list before continuing.</Notice>
        )}
        <ProfileConflicts edit={edit} dispatch={dispatch} />
        {!loading && bot && (
          <PebbleProfileFields
            value={value}
            onChange={(patch) => dispatch({ type: 'change', patch })}
            client={client}
            profile={profile}
            onAvatarBusy={setAvatarBusy}
            revision={revision}
          >
            <RoleBasics
              {...role}
              onChange={(patch) =>
                dispatch({ type: 'change', patch: { role: { ...role, ...patch } } })
              }
            />
            <ReportingField
              state={state}
              profile={profile}
              manager={manager}
              onChange={(manager) => dispatch({ type: 'change', patch: { manager } })}
            />
            <RoleDetails
              role={role}
              onChange={(patch) =>
                dispatch({ type: 'change', patch: { role: { ...role, ...patch } } })
              }
            />
          </PebbleProfileFields>
        )}
      </div>
      <footer className="profile-footer">
        <label className="intro-choice">
          <input
            type="checkbox"
            checked={introduce}
            onChange={(e) => setIntroduce(e.target.checked)}
          />
          Send me a welcome message
        </label>
        <Button
          disabled={
            loading ||
            busy ||
            !bot ||
            retired ||
            edit.retired ||
            uncertain ||
            !!edit.conflicts.length ||
            avatarBusy
          }
        >
          Add pebble
        </Button>
      </footer>
    </form>
  );
}
