import { useEffect, useState, useCallback, useReducer } from 'react';
import { ArrowLeft, ChevronRight, UserPlus, Users } from 'lucide-react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { WorkspaceDomain, decodeModelGrant } from '@hermes-client/protocol';
import { safeError } from '@hermes-client/core';
import type { WorkspaceSnapshot as WorkspaceState } from '@hermes-client/protocol';
import {
  emptyProfile,
  profileSession,
  profileReducer,
  profileDirty,
} from './profiles/edit-session';
import { profileWriteError } from './profiles/save-outcome';
import { AgentPicker } from './AgentPicker';
import { ExistingPebbleSetup } from './ExistingPebbleSetup';
import {
  PebbleProfileFields,
  RoleBasics,
  RoleDetails,
  ReportingField,
} from './ui/pebble-profile-fields';
import type { ProfileDraft } from './ui/pebble-profile-fields';
import { PageHeader, Notice } from './ui/primitives';
import { Button } from './components/ui/button';
import { IconButton } from './components/ui/icon-button';
import { Textarea } from './components/ui/textarea';
import { LoadingBar } from './components/ui/loading-bar';
import { Drawer } from './chat/Drawer';
import { RequestReview } from './chat/RequestReview';
type Row = Record<string, unknown>;
type Step =
  | { kind: 'choose' }
  | { kind: 'existing' }
  | { kind: 'configure'; profile: string }
  | { kind: 'create' };
export function NewPebble({
  client,
  state,
  connected,
  onClose,
  onDone,
  onDirtyChange,
}: {
  client: BotBridgeClient;
  state: WorkspaceState;
  connected: boolean;
  onClose: () => void;
  onDone: (profile?: string, introduce?: boolean) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [childDirty, setChildDirty] = useState(false);
  const [backConfirm, setBackConfirm] = useState(false);
  const [createdIdentity, setCreatedIdentity] = useState<{ profile: string; id: string }>();
  const reportChildDirty = useCallback(
    (dirty: boolean) => {
      setChildDirty(dirty);
      onDirtyChange(dirty);
    },
    [onDirtyChange],
  );
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [edit, dispatch] = useReducer(profileReducer, undefined, () =>
    profileSession(emptyProfile(state.orchestrator || '')),
  );
  const value = edit.draft,
    { role, manager } = value;
  const [soul, setSoul] = useState(''),
    [handleTouched, setHandleTouched] = useState(false),
    [introduce, setIntroduce] = useState(true),
    [avatarBusy, setAvatarBusy] = useState(false);
  const [model, setModel] = useState<WorkspaceState['model_grant']>(),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [request, setRequest] = useState<Row>();
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    if (step.kind !== 'create') return;
    let live = true;
    setLoading(true);
    void client
      .invoke('models.describe', {})
      .then((v) => {
        if (live) setModel(decodeModelGrant(v));
      })
      .catch(() => {
        if (live) setError('Model settings could not be loaded.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, step.kind]);
  const createDirty = profileDirty(edit) || !!soul;
  useEffect(() => {
    if (step.kind !== 'configure') onDirtyChange(step.kind === 'create' && !request && createDirty);
    return () => onDirtyChange(false);
  }, [step.kind, createDirty, request, onDirtyChange]);
  function patch(change: Partial<ProfileDraft>) {
    dispatch({
      type: 'change',
      patch: {
        ...change,
        ...(change.name !== undefined && !handleTouched
          ? {
              handle: change.name
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 32),
            }
          : {}),
      },
    });
    if (change.handle !== undefined) setHandleTouched(true);
  }
  async function finishProfile(target: { profile: string; id: string }) {
    const domain = new WorkspaceDomain(client);
    const next = await domain.describeWorkspace();
    if (
      !next.bots.some(
        (b) => b.profile === target.profile && b.id === target.id && b.available !== false,
      )
    )
      throw new Error('The created profile is unavailable.');
    setCreatedIdentity(target);
    const result = await domain.onboardExisting({
      target,
      name: value.name,
      handle: value.handle,
      appearance: value.appearance,
      photo: value.photo ? { kind: 'replace', data: value.photo } : { kind: 'preserve' },
      role,
      manager: manager || next.orchestrator,
      expectedRevision: next.revision,
    });
    if (result.kind !== 'confirmed') {
      setUncertain(result.kind === 'uncertain');
      setError(profileWriteError(result));
      return;
    }
    await onDone(target.profile, introduce);
  }
  function creationIdentity(completed: Row) {
    const receipt = completed.result as Row | undefined;
    if (
      !receipt ||
      typeof receipt.id !== 'string' ||
      receipt.profile !== value.handle.replace(/_/g, '-')
    )
      throw new Error('The creation result could not be verified.');
    return { profile: receipt.profile as string, id: receipt.id };
  }
  async function checkRequest(decision?: boolean) {
    if (busy || !request) return;
    setBusy(true);
    setError('');
    try {
      const list = (await client.invoke('requests.list', {})) as { requests: Row[] };
      let saved = list.requests.find(
        (r) => r.id === request.id && r.fingerprint === request.fingerprint,
      );
      if (!saved) throw new Error('The creation request is unavailable.');
      if (saved.state === 'pending' && decision !== undefined) {
        const result = (await client.invoke(decision ? 'requests.approve' : 'requests.deny', {
          id: saved.id,
          fingerprint: saved.fingerprint,
        })) as Row;
        saved = { ...saved, ...result };
      }
      setRequest(saved);
      if (saved.state === 'completed') await finishProfile(creationIdentity(saved));
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (busy || uncertain || (!createdIdentity && (!model?.supported || request))) return;
    setBusy(true);
    setError('');
    const nativeName = value.handle.replace(/_/g, '-');
    try {
      let target = createdIdentity;
      if (!target) {
        if (!model?.supported) return;
        const latest = await new WorkspaceDomain(client).describeWorkspace();
        const spec = {
          name: nativeName,
          display_name: value.name,
          soul:
            soul.trim() ||
            `Your name is ${value.name}. Follow the owner's instructions and coordinate through your available tools.`,
          role: role.description,
          model_source: 'default',
          model_fingerprint: model.fingerprint,
          skills: [],
          toolsets: ['workspace', 'skills'],
          manager: manager || latest.orchestrator,
          team: null,
          expected_revision: latest.revision,
        };
        const proposed = (await client.invoke('agent.propose', {
          action: 'agent.create',
          spec,
        })) as Row;
        const list = (await client.invoke('requests.list', {})) as { requests: Row[] };
        const exact = list.requests.find((r) => r.id === proposed.request_id);
        if (!exact || exact.action !== 'agent.create' || typeof exact.fingerprint !== 'string')
          throw new Error('The creation request changed.');
        setRequest(exact);
        const approved = (await client.invoke('requests.approve', {
          id: exact.id,
          fingerprint: exact.fingerprint,
        })) as Row;
        setRequest({ ...exact, ...approved });
        if (approved.state !== 'completed')
          throw new Error('Creation needs review before another attempt.');
        target = creationIdentity(approved);
        setCreatedIdentity(target);
      }
      await finishProfile(target);
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  const title =
    step.kind === 'choose'
      ? 'New pebble'
      : step.kind === 'existing'
        ? 'Choose a Hermes agent'
        : step.kind === 'configure'
          ? 'Add your agent'
          : 'Create a pebble';
  return (
    <section className="entity-page new-pebble" aria-label="New pebble">
      <div className="new-pebble-header">
        {step.kind !== 'choose' && (
          <IconButton
            label="Back"
            icon={ArrowLeft}
            disabled={busy}
            onClick={() => {
              if (
                (step.kind === 'create' && createDirty && !request) ||
                (step.kind === 'configure' && childDirty)
              ) {
                setBackConfirm(true);
                return;
              }
              setStep({ kind: step.kind === 'configure' ? 'existing' : 'choose' });
            }}
          />
        )}
        <PageHeader title={title} onClose={onClose} />
      </div>
      {step.kind === 'choose' ? (
        <div className="creation-choices">
          <Button variant="ghost" onClick={() => setStep({ kind: 'existing' })}>
            <Users />
            <span>Add existing Hermes agent</span>
            <ChevronRight />
          </Button>
          <Button variant="ghost" onClick={() => setStep({ kind: 'create' })}>
            <UserPlus />
            <span>Create new pebble</span>
            <ChevronRight />
          </Button>
        </div>
      ) : step.kind === 'existing' ? (
        <AgentPicker
          client={client}
          state={state}
          connected={connected}
          onChoose={(profile) => setStep({ kind: 'configure', profile })}
        />
      ) : step.kind === 'configure' ? (
        <ExistingPebbleSetup
          key={step.profile}
          client={client}
          profile={step.profile}
          state={state}
          onDone={onDone}
          onDirtyChange={reportChildDirty}
        />
      ) : (
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
          aria-busy={busy}
        >
          <LoadingBar active={loading || busy} label="Creating pebble" />
          <div className="profile-content" inert={busy}>
            {error && <Notice error>{error}</Notice>}
            {request && !createdIdentity && !busy ? (
              <div>
                <RequestReview
                  request={request}
                  busy={busy}
                  onDecision={(approve) => void checkRequest(approve)}
                  onInspect={() => void checkRequest()}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void checkRequest()}
                >
                  Check status
                </Button>
              </div>
            ) : (
              <>
                <PebbleProfileFields value={value} onChange={patch} onAvatarBusy={setAvatarBusy}>
                  <RoleBasics
                    {...role}
                    onChange={(change) =>
                      dispatch({ type: 'change', patch: { role: { ...role, ...change } } })
                    }
                  />
                  <ReportingField
                    state={state}
                    manager={manager}
                    onChange={(manager) => dispatch({ type: 'change', patch: { manager } })}
                  />
                  <RoleDetails
                    role={role}
                    onChange={(change) =>
                      dispatch({ type: 'change', patch: { role: { ...role, ...change } } })
                    }
                  />
                </PebbleProfileFields>
                <details className="form-disclosure">
                  <summary>Model and personality</summary>
                  <p>
                    {model?.supported
                      ? `${model.provider} · ${model.model}`
                      : 'Configure your model in Hermes to create a new pebble.'}
                  </p>
                  <label>
                    Personality
                    <Textarea
                      rows={4}
                      maxLength={12000}
                      value={soul}
                      onChange={(e) => setSoul(e.target.value)}
                    />
                  </label>
                </details>
              </>
            )}
          </div>
          {(!request || createdIdentity) && (
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
                  busy ||
                  uncertain ||
                  loading ||
                  !connected ||
                  (!createdIdentity && !model?.supported) ||
                  avatarBusy
                }
              >
                {createdIdentity ? 'Finish setup' : 'Create pebble'}
              </Button>
            </footer>
          )}
        </form>
      )}
      {backConfirm && (
        <Drawer title="Unsaved changes" variant="dialog" onClose={() => setBackConfirm(false)}>
          <h2>Discard unsaved changes?</h2>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setBackConfirm(false)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                setBackConfirm(false);
                onDirtyChange(false);
                setStep({ kind: step.kind === 'configure' ? 'existing' : 'choose' });
              }}
            >
              Discard changes
            </Button>
          </div>
        </Drawer>
      )}
    </section>
  );
}
