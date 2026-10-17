import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Search } from 'lucide-react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import type { WorkspaceSnapshot as WorkspaceState } from '@hermes-client/protocol';
import { AgentAvatar } from './AgentAvatar';
import { Input } from './components/ui/input';
import { LoadingBar } from './components/ui/loading-bar';
type Agent = {
  profile: string;
  name: string;
  description: string;
  managed: boolean;
  canonical: boolean;
  hidden: boolean;
};
export function AgentPicker({
  client,
  state,
  connected,
  onChoose,
}: {
  client: BotBridgeClient;
  state: WorkspaceState;
  connected: boolean;
  onChoose: (profile: string) => void;
}) {
  const [agents, setAgents] = useState<Agent[]>([]),
    [query, setQuery] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    input.current?.focus();
    void client
      .invoke('agents.list', {})
      .then((value) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('agents' in value) ||
          !Array.isArray(value.agents) ||
          value.agents.length > 10000
        )
          throw new Error();
        const rows = value.agents.map((row: unknown): Agent => {
          if (
            !row ||
            typeof row !== 'object' ||
            !('profile' in row) ||
            typeof row.profile !== 'string' ||
            !('name' in row) ||
            typeof row.name !== 'string'
          )
            throw new Error();
          return {
            profile: row.profile,
            name: row.name,
            description:
              'description' in row && typeof row.description === 'string' ? row.description : '',
            managed: 'managed' in row && row.managed === true,
            canonical: 'canonical' in row && row.canonical === true,
            hidden: 'hidden' in row && row.hidden === true,
          };
        });
        if (live) setAgents(rows);
      })
      .catch(() => {
        if (live) setError('Agents could not be loaded. Try again.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client]);
  const visible = agents.filter((agent) =>
    `${agent.name} ${agent.profile}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="agent-picker" aria-label="Existing Hermes agents">
      <div className="agent-search-field">
        <Search aria-hidden="true" />
        <Input
          ref={input}
          type="search"
          aria-label="Search Hermes agents"
          placeholder="Search agents…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <LoadingBar active={loading} label="Loading agents" />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="agent-options" role="region" aria-label="Available Hermes agents">
        {visible.map((agent) => {
          const added = agent.managed && agent.canonical && !agent.hidden,
            bot = state.bots.find((b) => b.profile === agent.profile);
          return (
            <button
              className="agent-choice"
              key={agent.profile}
              disabled={!connected || added}
              onClick={() => onChoose(agent.profile)}
            >
              {bot && (
                <AgentAvatar
                  id={bot.id}
                  profile={bot.profile}
                  client={client}
                  look={bot.appearance}
                />
              )}
              <span>
                <strong>{agent.name}</strong>
                <small>@{bot?.handle ?? agent.profile}</small>
              </span>
              {added ? <Check aria-label="Added" /> : <ChevronRight aria-hidden="true" />}
            </button>
          );
        })}
        {!loading && !visible.length && (
          <p className="empty-note">{query ? 'No matching agents.' : 'No agents available.'}</p>
        )}
      </div>
    </section>
  );
}
