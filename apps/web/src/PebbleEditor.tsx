import { LoadingBar } from './components/ui/loading-bar';
import { Button } from './components/ui/button';
import { useEffect, useReducer, useState } from 'react';
import type {
  WorkspaceAgentCapabilities,
  BotBridgeClient,
  WriteOutcome,
} from '@hermes-client/protocol';
import { WorkspaceDomain } from '@hermes-client/protocol';
import {
  profileValues,
  profileSession,
  profileReducer,
  profileDirty,
  profileSection,
} from './profiles/edit-session';
import { ProfileConflicts } from './profiles/ProfileConflicts';
import { profileWriteError } from './profiles/save-outcome';
import { emptyTools, toolReducer, toolsDirty } from './profiles/tool-session';
import type {
  WorkspaceSnapshot as WorkspaceState,
  WorkspaceBot,
  Role,
} from '@hermes-client/protocol';
import {
  PebbleProfileFields,
  RoleBasics,
  RoleDetails,
  ReportingField,
} from './ui/pebble-profile-fields';
import { PageHeader, FormSection, Notice, Tabs } from './ui/primitives';
import { Drawer } from './chat/Drawer';
import { safeError } from '@hermes-client/core';
export function PebbleEditor({
  client,
  bot,
  state,
  onChange,
  onClose,
  onDirtyChange,
  retired = false,
}: {
  client: BotBridgeClient;
  bot: WorkspaceBot;
  state: WorkspaceState;
  onChange: (state: WorkspaceState) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  retired?: boolean;
}) {
  const [tab, setTab] = useState('identity');
  const [edit, dispatch] = useReducer(profileReducer, undefined, () =>
    profileSession(profileValues(bot), bot.id, state.revision),
  );
  const { name, handle, appearance: look, role, manager, team, photo } = edit.draft;
  const setRole = (change: (role: Role) => Role) =>
    dispatch({ type: 'change', patch: { role: change(role) } });
  const setManager = (manager: string) => dispatch({ type: 'change', patch: { manager } });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [pending, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [discard, setDiscard] = useState(false);
  const [capabilities, setCapabilities] = useState<WorkspaceAgentCapabilities>();
  const [toolEdit, dispatchTools] = useReducer(toolReducer, emptyTools);
  const { skills, toolsets } = toolEdit.draft;
  const setSkills = (skills: string[]) => dispatchTools({ type: 'change', patch: { skills } });
  const setToolsets = (toolsets: string[]) =>
    dispatchTools({ type: 'change', patch: { toolsets } });
  const busy = retired || edit.retired ? 'retired' : pending;
  const [toolsLoading, setToolsLoading] = useState(true);
  const conflicts = Object.fromEntries(
    edit.conflicts.map((field) => [profileSection(field), true]),
  );
  useEffect(() => {
    dispatch({
      type: 'receive',
      values: profileValues(bot),
      identity: bot.id,
      revision: state.revision,
    });
  }, [bot, state.revision]);
  useEffect(() => {
    let live = true;
    setToolsLoading(true);
    void new WorkspaceDomain(client)
      .describeAgentCapabilities(bot.profile)
      .then((value) => {
        if (!live) return;
        setCapabilities(value);
        const s = value.skills.filter((x) => x.enabled).map((x) => String(x.name)),
          t = value.toolsets.filter((x) => x.enabled).map((x) => String(x.name));
        dispatchTools({ type: 'receive', value: { skills: s, toolsets: t } });
      })
      .catch(() => {
        if (live) setCapabilities(undefined);
      })
      .finally(() => {
        if (live) setToolsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, bot.profile]);
  const dirty = profileDirty(edit) || toolsDirty(toolEdit);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  async function save(section: 'profile' | 'role' | 'tools' | 'lead' | 'model') {
    if (
      busy ||
      uncertain ||
      (section === 'profile' ? edit.conflicts.length : conflicts[section]) ||
      (section === 'tools' && toolEdit.conflict)
    )
      return;
    setBusy(section);
    setError('');
    setNotice('');
    const submitted = edit.draft,
      submittedTools = toolEdit.draft;
    const domain = new WorkspaceDomain(client);
    let confirmed = false;
    try {
      let outcome: WriteOutcome<unknown>;
      if (section === 'profile')
        outcome = await domain.updateProfile({
          target: { id: bot.id, profile: bot.profile },
          expectedRevision: state.revision,
          name,
          handle,
          appearance: look,
          role,
          manager: bot.profile === state.orchestrator ? null : manager || state.orchestrator,
          photo: photo ? { kind: 'replace', data: photo } : { kind: 'preserve' },
        });
      else if (section === 'role')
        outcome = await domain.updateRoleAssignment({
          profile: bot.profile,
          expectedRevision: state.revision,
          role,
          manager: bot.profile === state.orchestrator ? null : manager || state.orchestrator,
          team: team || null,
        });
      else if (section === 'tools')
        outcome = await domain.attachTools({
          profile: bot.profile,
          expectedRevision: state.revision,
          ...submittedTools,
        });
      else if (section === 'lead')
        outcome = await domain.selectMainPebble(bot.profile, state.revision);
      else
        outcome = await domain.selectModel(
          bot.profile,
          state.revision,
          state.model_grant!.fingerprint,
        );
      if (outcome.kind !== 'confirmed') {
        setUncertain(outcome.kind === 'uncertain');
        setError(profileWriteError(outcome));
        return;
      }
      confirmed = true;
      if (section === 'profile' || section === 'role')
        dispatch({ type: 'saved', submitted, section });
      if (section === 'tools') dispatchTools({ type: 'saved', submitted: submittedTools });
      onChange(await domain.describeWorkspace());
      setNotice(
        `${section === 'tools' ? 'Tools and skills' : section === 'role' ? 'Role' : section === 'lead' ? 'Main Pebble' : section === 'model' ? 'Model' : 'Profile'} saved.`,
      );
    } catch (e) {
      if (!confirmed) {
        setUncertain(true);
        setError(
          'The save could not be confirmed. Reopen this profile to review it before saving again.',
        );
      } else setError(safeError(e).message);
    } finally {
      setBusy('');
    }
  }
  const close = () => {
    if (dirty) setDiscard(true);
    else onClose();
  };
  return (
    <section className="entity-page" aria-label={`Edit ${bot.name}`}>
      <PageHeader title={`Edit ${bot.name}`} subtitle={`@${bot.handle}`} onClose={close} />
      {retired && (
        <Notice error>
          This pebble was removed or replaced. Your unsaved fields remain here to copy; changes
          cannot be saved to a different pebble.
        </Notice>
      )}
      <Tabs
        tabs={[
          { id: 'identity', label: 'Profile' },
          { id: 'role', label: 'Role' },
          { id: 'tools', label: 'Tools & skills' },
          { id: 'model', label: 'Model' },
        ]}
        value={tab}
        onChange={(id) => {
          setTab(id);
          setError('');
          setNotice('');
        }}
      >
        {error && <Notice error>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        <ProfileConflicts edit={edit} dispatch={dispatch} />
        {tab === 'identity' && (
          <form
            className="profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save('profile');
            }}
          >
            <div className="profile-content">
              <PebbleProfileFields
                value={{ name, handle, appearance: look, photo }}
                onChange={(patch) => dispatch({ type: 'change', patch })}
                client={client}
                profile={bot.profile}
                onAvatarBusy={setPhotoBusy}
                revision={state.revision}
              >
                <RoleBasics
                  title={role.title}
                  description={role.description}
                  onChange={(change) => setRole((old) => ({ ...old, ...change }))}
                />
                <ReportingField
                  state={state}
                  profile={bot.profile}
                  manager={manager}
                  onChange={setManager}
                />
                <RoleDetails
                  role={role}
                  onChange={(patch) => setRole((old) => ({ ...old, ...patch }))}
                />
              </PebbleProfileFields>
            </div>
            <footer className="profile-footer">
              <Button
                disabled={
                  !!busy ||
                  uncertain ||
                  !!conflicts.profile ||
                  !!conflicts.appearance ||
                  !!conflicts.handle ||
                  !!conflicts.role ||
                  photoBusy
                }
              >
                Save profile
              </Button>
            </footer>
          </form>
        )}
        {tab === 'role' && (
          <FormSection title="Role & reporting">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save('role');
              }}
            >
              <RoleBasics
                title={role.title}
                description={role.description}
                onChange={(patch) => setRole((old) => ({ ...old, ...patch }))}
              />
              <ReportingField
                state={state}
                profile={bot.profile}
                manager={manager}
                onChange={setManager}
              />
              <RoleDetails
                role={role}
                onChange={(patch) => setRole((old) => ({ ...old, ...patch }))}
              />
              <div className="form-actions">
                <Button variant="secondary" disabled={!!busy || uncertain || !!conflicts.role}>
                  Save role
                </Button>
              </div>
            </form>
            {bot.enrolled && bot.profile !== state.orchestrator && (
              <details className="form-disclosure">
                <summary>Make Main Pebble</summary>
                <p>
                  {bot.name} will coordinate your pebbles. The current Main Pebble will report to
                  them.
                </p>
                <Button
                  variant="secondary"
                  disabled={!!busy || uncertain}
                  onClick={() => void save('lead')}
                >
                  Make {bot.name} Main Pebble
                </Button>
              </details>
            )}
          </FormSection>
        )}
        {tab === 'tools' && (
          <FormSection title="Tools & skills">
            {toolEdit.conflict && (
              <Notice>
                Tools changed while you were editing.
                <div className="form-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => dispatchTools({ type: 'resolve', useSaved: true })}
                  >
                    Use saved tools
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => dispatchTools({ type: 'resolve', useSaved: false })}
                  >
                    Keep my tool edits
                  </Button>
                </div>
              </Notice>
            )}
            {!capabilities ? (
              toolsLoading ? (
                <LoadingBar active label="Loading tools and skills" />
              ) : (
                <Notice error>Tools could not be loaded. Reopen this editor to try again.</Notice>
              )
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save('tools');
                }}
              >
                <fieldset>
                  <legend>Tools</legend>
                  {capabilities.toolsets.map((t) => (
                    <label className="selection-row" key={String(t.name)}>
                      <input
                        type="checkbox"
                        checked={toolsets.includes(String(t.name))}
                        onChange={(e) =>
                          setToolsets(
                            e.target.checked
                              ? [...toolsets, t.name]
                              : toolsets.filter((x) => x !== t.name),
                          )
                        }
                      />
                      <span>
                        <strong>{String(t.label || t.name)}</strong>
                        <small>{String(t.description || '')}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Skills</legend>
                  {capabilities.skills.map((t) => (
                    <label className="selection-row" key={String(t.name)}>
                      <input
                        type="checkbox"
                        checked={t.required === true || skills.includes(String(t.name))}
                        disabled={t.required === true}
                        onChange={(e) =>
                          setSkills(
                            e.target.checked
                              ? [...skills, String(t.name)]
                              : skills.filter((x) => x !== t.name),
                          )
                        }
                      />
                      <span>
                        {String(t.name)}
                        {t.required === true && <small>Required by Hermes</small>}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <p className="field-hint">
                  Saved access takes effect when Hermes refreshes this pebble’s runtime.
                </p>
                <div className="form-actions">
                  <Button
                    variant="secondary"
                    disabled={!!busy || uncertain || toolEdit.conflict || !toolsets.length}
                  >
                    Save tools & skills
                  </Button>
                </div>
              </form>
            )}
          </FormSection>
        )}
        {tab === 'model' && (
          <FormSection title="Model">
            {state.model_grant ? (
              <>
                <p>
                  {state.model_grant.provider} · {state.model_grant.model}
                </p>
                {bot.profile !== 'default' &&
                  (state.model_grant.supported ? (
                    <>
                      <p className="field-hint">
                        Use the primary profile’s selected model authorization. Other service
                        credentials are not copied.
                      </p>
                      <Button
                        variant="secondary"
                        disabled={!!busy || uncertain}
                        onClick={() => void save('model')}
                      >
                        Use this model
                      </Button>
                    </>
                  ) : (
                    <Notice>This model needs authorization in Hermes.</Notice>
                  ))}
              </>
            ) : (
              <Notice>Model information is unavailable.</Notice>
            )}
          </FormSection>
        )}
      </Tabs>
      {busy && (
        <span className="sr-only" role="status">
          Saving…
        </span>
      )}
      {discard && (
        <Drawer title="Unsaved changes" variant="dialog" onClose={() => setDiscard(false)}>
          <h2>Discard unsaved changes?</h2>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setDiscard(false)}>
              Keep editing
            </Button>
            <Button
              variant="secondary"
              className="danger-text"
              onClick={() => {
                onDirtyChange(false);
                onClose();
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
