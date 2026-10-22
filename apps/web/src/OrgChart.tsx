import { useEffect, useState } from 'react';
import { ReportingDomain } from '@hermes-client/protocol';
import type { SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { LoadingBar } from './components/ui/loading-bar';
import { OrganizationDiagram } from './org/OrganizationDiagram';
import { Disclosure } from './components/ui/disclosure';
import { PageHeader, Notice } from './ui/primitives';

export function OrgChart({
  client,
  state,
  onEdit,
  onClose,
  onNavigate,
}: {
  client: SessionClient;
  state: WorkspaceSnapshot;
  onEdit: (profile: string) => void;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<ReportingDomain['read']>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const value = await new ReportingDomain(client).read();
        if (current) {
          setData((previous) =>
            previous && previous.workspace.revision > value.workspace.revision ? previous : value,
          );
          setError('');
        }
      } catch {
        if (current)
          setError('Could not load the organization. Try again when Hermes is connected.');
      } finally {
        if (current) timer = setTimeout(() => void refresh(), 5000);
      }
    }
    void refresh();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, state.revision]);
  const workspace = data && data.workspace.revision >= state.revision ? data.workspace : state;
  return (
    <section className="pc-org-page" aria-label="Org chart">
      <PageHeader title="Org chart" onClose={onClose} onNavigate={onNavigate} />
      {error && <Notice>{error}</Notice>}
      <LoadingBar active={!data && !error} label="Loading organization" />
      <OrganizationDiagram workspace={workspace} client={client} onEdit={onEdit} />
      {!!data?.changes.length && (
        <Disclosure title="Recent changes" className="pc-org-history">
          <ul className="pc-org-changes">
            {data.changes.slice(0, 8).map((change) => (
              <li key={change.id}>
                <span>
                  {workspace.bots.find((bot) => bot.profile === change.profile)?.name ??
                    change.profile}
                </span>
                <span>
                  {change.state === 'applied'
                    ? 'Saved'
                    : change.state === 'refused'
                      ? 'Needs review'
                      : change.state === 'uncertain'
                        ? 'Needs verification'
                        : 'Saving…'}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
