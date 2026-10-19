import { useEffect, useState } from 'react';
import { ReportingDomain, reportingForest } from '@hermes-client/protocol';
import type { BotBridgeClient, WorkspaceBot, WorkspaceSnapshot } from '@hermes-client/protocol';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Switch } from './components/ui/switch';
import { LoadingBar } from './components/ui/loading-bar';
import { PebbleAvatar } from './chat/Rail';
import { PageHeader, Notice } from './ui/primitives';

export function OrgChart({
  client,
  state,
  onChange,
  onEdit,
  onClose,
  onNavigate,
}: {
  client: BotBridgeClient;
  state: WorkspaceSnapshot;
  onChange: (state: WorkspaceSnapshot) => void;
  onEdit: (profile: string) => void;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<ReportingDomain['read']>>>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
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
  const forest = reportingForest(workspace);
  async function toggle(enabled: boolean) {
    setPending(true);
    setError('');
    try {
      const result = await new ReportingDomain(client).setManagement(workspace, enabled);
      setData(result);
      onChange(result.workspace);
    } catch {
      setError(
        'The permission change could not be confirmed. Reopen the org chart before trying again.',
      );
    } finally {
      setPending(false);
    }
  }
  function branch(bot: WorkspaceBot, depth = 0) {
    const reports = forest.children.get(bot.profile) ?? [];
    return (
      <li key={bot.id} className="pc-org-branch" data-org-profile={bot.profile}>
        <Card className="pc-org-card gap-0 py-0 shadow-none">
          <Button
            variant="ghost"
            className="pc-org-card-open"
            aria-label={`Edit ${bot.name}`}
            onClick={() => onEdit(bot.profile)}
          >
            <PebbleAvatar bot={bot} workspace={workspace} client={client} />
            <span className="pc-org-identity">
              <span className="pc-org-name">{bot.name}</span>
              {bot.role.title && <span className="pc-org-role">{bot.role.title}</span>}
              <span className="pc-org-handle">@{bot.handle}</span>
            </span>
            {bot.profile === workspace.orchestrator && (
              <span className="pc-org-main">Main Pebble</span>
            )}
          </Button>
          {(bot.profile === workspace.orchestrator || reports.length > 0 || bot.hidden) && (
            <div className="pc-org-card-footer">
              <span>
                {bot.profile === workspace.orchestrator
                  ? 'Reports to you'
                  : reports.length > 0
                    ? `${reports.length} direct ${reports.length === 1 ? 'report' : 'reports'}`
                    : ''}
              </span>
              {bot.hidden && <span>Hidden from chats</span>}
            </div>
          )}
        </Card>
        {reports.length > 0 && depth < workspace.bots.length && (
          <ul className="pc-org-children">{reports.map((child) => branch(child, depth + 1))}</ul>
        )}
      </li>
    );
  }
  return (
    <section className="pc-org-page" aria-label="Org chart">
      <PageHeader title="Org chart" onClose={onClose} onNavigate={onNavigate} />
      <div className="pc-org-scroll">
        {error && <Notice>{error}</Notice>}
        <div className="pc-org-management">
          <label htmlFor="main-pebble-management">
            <span>Main Pebble management</span>
            <span className="pc-org-hint">Reporting relationships and agent instructions</span>
          </label>
          <Switch
            id="main-pebble-management"
            checked={workspace.reporting?.management_enabled ?? false}
            disabled={pending || !workspace.reporting}
            onCheckedChange={(value) => void toggle(value)}
          />
        </div>
        <LoadingBar active={!data && !error} label="Loading organization" />
        {forest.main && (
          <ul className="pc-org-tree" aria-label="Reporting relationships">
            {branch(forest.main)}
          </ul>
        )}
        {forest.unattached.length > 0 && (
          <section className="pc-org-group">
            <h2>Unattached</h2>
            <ul className="pc-org-tree">{forest.unattached.map((bot) => branch(bot))}</ul>
          </section>
        )}
        {forest.invalid.length > 0 && (
          <section className="pc-org-group">
            <h2>Needs attention</h2>
            <p className="pc-org-hint">
              Choose a current manager or leave these pebbles unattached.
            </p>
            <ul className="pc-org-tree">{forest.invalid.map((bot) => branch(bot))}</ul>
          </section>
        )}
        {!!data?.changes.length && (
          <section className="pc-org-group">
            <h2>Recent changes</h2>
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
          </section>
        )}
      </div>
    </section>
  );
}
