import { ApprovalSurface } from '../components/ai-elements/confirmation';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Disclosure } from '../components/ui/disclosure';
import { useState } from 'react';
import type { Row } from '../conversation';
export function RequestReview({
  request: r,
  busy,
  onDecision,
  onInspect,
}: {
  request: Row;
  busy: boolean;
  onDecision: (approve: boolean, confirmation?: string) => void;
  onInspect: () => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  const spec = (r.spec ?? {}) as Row,
    result = (r.result ?? {}) as Row;
  const deleting = r.action === 'agent.delete';
  const titles: Record<string, string> = {
    'agent.delete': 'Delete pebble',
    'agent.hide': spec.hidden ? 'Hide pebble' : 'Unhide pebble',
    'agent.create': 'Create pebble',
    'agent.enable': 'Add existing pebble',
    'agent.update': 'Update role',
    'agent.attach': 'Change tools and skills',
  };
  return (
    <ApprovalSurface
      className={`request-card ${deleting ? 'destructive-request' : ''}`}
      title={titles[String(r.action)] ?? String(r.action)}
      description={
        <>
          <strong>{String(spec.profile ?? spec.display_name ?? spec.name ?? 'Agent')}</strong> ·{' '}
          {String(r.state)}
        </>
      }
    >
      {deleting && (
        <p>
          Removes this Hermes profile, its personality files, memory, local conversations, skills
          and service. Crew history stays; this member can no longer work. This cannot be undone
          here.
        </p>
      )}
      {r.action === 'agent.hide' && (
        <p>
          {spec.hidden
            ? 'Removes it from the sidebar. Its profile, conversations and crew membership stay.'
            : 'Returns it to the sidebar.'}
        </p>
      )}
      <dl className="request-fields">
        {Object.entries(spec)
          .filter(
            ([key]) =>
              !['id', 'expected_revision', 'profile', 'soul', 'model_fingerprint'].includes(key),
          )
          .flatMap(([key, value]) => {
            const labels: Record<string, string> = {
              name: 'Handle',
              display_name: 'Name',
              model_source: 'Model authorization',
              manager: 'Reports to',
              team: 'Crew',
              toolsets: 'Tools',
              skills: 'Skills',
              role: 'Description',
              initialize_chat: 'Bot Chat',
              hidden: 'Hidden',
              responsibilities: 'Responsibilities',
              boundaries: 'Boundaries',
              expectedOutputs: 'Expected outputs',
              title: 'Title',
              description: 'Description',
            };
            const fields: [string, unknown][] =
              value && typeof value === 'object' && !Array.isArray(value)
                ? Object.entries(value as Row)
                : [[key, value]];
            return fields.map(([field, content]) => (
              <div key={`${key}:${field}`}>
                <dt>{labels[field] ?? field.replaceAll('_', ' ')}</dt>
                <dd>
                  {content == null
                    ? 'None'
                    : Array.isArray(content)
                      ? content.map(String).join(', ') || 'None'
                      : typeof content === 'boolean'
                        ? content
                          ? 'Yes'
                          : 'No'
                        : field === 'model_source' && content === 'default'
                          ? 'Primary profile’s selected model'
                          : String(content)}
                </dd>
              </div>
            ));
          })}
      </dl>
      {spec.soul != null && (
        <Disclosure title="Personality">
          <p className="preserve-whitespace">{String(spec.soul)}</p>
        </Disclosure>
      )}
      {Boolean(result.reason || result.error) && (
        <p role="status">{String(result.reason ?? result.error)}</p>
      )}
      {r.state === 'pending' && (
        <>
          {deleting && (
            <Label className="flex-col items-start">
              Type <strong>{String(spec.profile)}</strong> to confirm
              <Input
                aria-label="Confirm profile name"
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Label>
          )}
          <div className="choice-row">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onDecision(false)}
            >
              Deny
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={deleting ? 'danger' : ''}
              disabled={busy || (deleting && confirmation !== spec.profile)}
              onClick={() => onDecision(true, deleting ? confirmation : undefined)}
            >
              {deleting ? 'Delete permanently' : 'Approve exact request'}
            </Button>
          </div>
        </>
      )}
      {deleting && ['executing', 'uncertain', 'partial'].includes(String(r.state)) && (
        <Button type="button" variant="secondary" disabled={busy} onClick={onInspect}>
          Check outcome
        </Button>
      )}
    </ApprovalSurface>
  );
}
