import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plug, Plus, Search } from 'lucide-react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import type { WorkspaceBot } from '@hermes-client/protocol';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { LoadingBar } from '../components/ui/loading-bar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Notice } from '../ui/primitives';
import { ConnectionDetail } from './ConnectionDetail';
import { connections, services } from './model';
import type { Connection, Remote, Service } from './model';

type View = { kind: 'list' } | { kind: 'catalog' } | { kind: 'detail'; connection: Connection };
export function ConnectionsPanel({
  client,
  bots,
  profile,
  revision,
  onProfile,
  onNavigate,
  onDirtyChange,
}: {
  client: BotBridgeClient;
  bots: WorkspaceBot[];
  profile: string;
  revision: number;
  onProfile: (profile: string) => void;
  onNavigate: (action: () => void) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [list, setList] = useState<Remote<Connection[]>>({ kind: 'loading' });
  const [catalog, setCatalog] = useState<Remote<Service[]>>({ kind: 'loading' });
  const [refresh, setRefresh] = useState(0);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');
  const [setup, setSetup] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const returnFocus = useRef('');
  const listScroll = useRef(0);
  const listView = list.kind === 'ready' ? list.value : [];
  const refreshList = useCallback(() => setRefresh((v) => v + 1), []);
  useEffect(() => {
    let live = true;
    setList({ kind: 'loading' });
    void client
      .invoke('connections.list', { profile })
      .then((v) => {
        const parsed = connections(v);
        if (live) setList({ kind: 'ready', value: parsed });
      })
      .catch(() => {
        if (live) setList({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [client, profile, refresh]);
  useEffect(() => {
    if (view.kind !== 'catalog') return;
    let live = true;
    setCatalog({ kind: 'loading' });
    void client
      .invoke('services.catalog', { profile })
      .then((v) => {
        const parsed = services(v);
        if (live) setCatalog({ kind: 'ready', value: parsed });
      })
      .catch(() => {
        if (live) setCatalog({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [client, profile, view.kind, catalogRetry]);
  useLayoutEffect(() => {
    const pane = root.current?.closest('.ui-tab-panel');
    if (!pane) return;
    pane.scrollTop = view.kind === 'list' ? listScroll.current : 0;
    if (view.kind === 'list' && returnFocus.current) {
      const target = [
        ...root.current!.querySelectorAll<HTMLElement>('[data-connection-trigger]'),
      ].find((n) => n.dataset.connectionTrigger === returnFocus.current);
      target?.focus({ preventScroll: true });
    } else if (view.kind !== 'list')
      root.current?.querySelector<HTMLElement>('[data-view-focus]')?.focus({ preventScroll: true });
  }, [view]);
  function show(next: View, trigger = '') {
    onNavigate(() => {
      if (view.kind === 'list') {
        listScroll.current = root.current?.closest('.ui-tab-panel')?.scrollTop ?? 0;
        returnFocus.current = trigger;
      }
      setError('');
      setSetup('');
      setQuery('');
      setView(next);
    });
  }
  async function add(service: Service) {
    if (adding) return;
    setAdding(service.name);
    setError('');
    try {
      await client.invoke('connections.add', {
        profile,
        recipe: service.name,
        name: service.name,
        expected_revision: revision,
      });
      setRefresh((v) => v + 1);
      setView({
        kind: 'detail',
        connection: {
          name: service.name,
          description: service.description,
          enabled: true,
          auth: null,
          needsSignIn: false,
        },
      });
    } catch {
      setError('Connection not confirmed. Check your connections before trying again.');
    } finally {
      setAdding('');
    }
  }
  return (
    <div className="connections-panel" ref={root}>
      <div className="connections-scope">
        <span id="connection-profile-label">Pebble</span>
        <Select
          disabled={!!adding}
          value={profile}
          onValueChange={(value) => onNavigate(() => onProfile(value))}
        >
          <SelectTrigger aria-labelledby="connection-profile-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bots.map((b) => (
              <SelectItem key={b.id} value={b.profile}>
                {b.name} · @{b.handle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {view.kind !== 'list' && (
        <Button
          disabled={!!adding}
          variant="quiet"
          className="connections-back"
          onClick={() => show({ kind: 'list' })}
        >
          <ChevronLeft aria-hidden="true" />
          Connections
        </Button>
      )}
      {view.kind === 'list' && (
        <>
          <header className="connections-heading">
            <h2>Connections</h2>
            <Button
              size="sm"
              variant="secondary"
              data-connection-trigger="add"
              onClick={() => show({ kind: 'catalog' }, 'add')}
            >
              <Plus aria-hidden="true" />
              Add connection
            </Button>
          </header>
          <LoadingBar active={list.kind === 'loading'} label="Loading connections" />
          {list.kind === 'error' && (
            <Notice error>
              Connections unavailable.{' '}
              <Button variant="link" onClick={() => setRefresh((v) => v + 1)}>
                Retry
              </Button>
            </Notice>
          )}
          {list.kind === 'ready' && (
            <div className="connection-list">
              {!list.value.length && <p className="connections-empty">No connections</p>}
              {list.value.map((connection) => (
                <button
                  className="connection-row"
                  key={connection.name}
                  data-connection-trigger={connection.name}
                  onClick={() => show({ kind: 'detail', connection }, connection.name)}
                >
                  <Plug aria-hidden="true" />
                  <span>
                    <strong>{connection.name}</strong>
                    <small>
                      {!connection.enabled
                        ? 'Disabled'
                        : connection.needsSignIn
                          ? 'Sign-in needed'
                          : 'Configured'}
                    </small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {view.kind === 'detail' && (
        <div tabIndex={-1} data-view-focus>
          <ConnectionDetail
            key={`${profile}:${view.connection.name}`}
            client={client}
            profile={profile}
            connection={listView.find((c) => c.name === view.connection.name) ?? view.connection}
            onDirtyChange={onDirtyChange}
            onChanged={refreshList}
          />
        </div>
      )}
      {view.kind === 'catalog' && (
        <>
          <h2 className="connections-view-title" tabIndex={-1} data-view-focus>
            Add connection
          </h2>
          <div className="connections-search">
            <Search aria-hidden="true" />
            <Input
              aria-label="Search services"
              placeholder="Search services"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <LoadingBar active={catalog.kind === 'loading' || !!adding} label="Loading services" />
          {error && <Notice error>{error}</Notice>}
          {setup && <Notice>{setup} needs setup in Hermes before it can be connected.</Notice>}
          {catalog.kind === 'error' && (
            <Notice error>
              Services unavailable.{' '}
              <Button variant="link" onClick={() => setCatalogRetry((v) => v + 1)}>
                Retry
              </Button>
            </Notice>
          )}
          {catalog.kind === 'ready' && (
            <div className="connection-catalog">
              {catalog.value
                .filter((s) =>
                  `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()),
                )
                .map((service) => (
                  <div className="connection-row" key={service.name}>
                    <Plug aria-hidden="true" />
                    <span>
                      <strong>{service.name}</strong>
                      <small>{service.description}</small>
                    </span>
                    {listView.some((c) => c.name === service.name) ? (
                      <span className="connection-added">Added</span>
                    ) : service.available ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!!adding}
                        onClick={() => void add(service)}
                      >
                        Add<span className="sr-only"> {service.name}</span>
                      </Button>
                    ) : (
                      <Button
                        variant="quiet"
                        size="sm"
                        aria-label={`About ${service.name} setup`}
                        onClick={() => setSetup(service.name)}
                      >
                        Setup needed
                      </Button>
                    )}
                  </div>
                ))}
              {!catalog.value.some((s) =>
                `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()),
              ) && (
                <p className="connections-empty">
                  {query ? 'No matching services' : 'No services available'}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
