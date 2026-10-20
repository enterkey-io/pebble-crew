import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { generalCatalog, aiCatalog, catalogSnapshot, type GeneralComponentId } from './catalog';
import { generalSpecimens } from './specimens/general';
import { AISpecimenPreview, PrivateRequestSpecimen } from './specimens/ai';
import type { SpecimenMode } from './specimen-types';

function Catalog<T extends { readonly id: string; readonly name: string }>({
  entries,
  children,
}: {
  entries: readonly [T, ...T[]] | readonly T[];
  children: (entry: T) => ReactNode;
}) {
  const initial =
    entries.find(
      (item) => item.id === new URLSearchParams(location.hash.slice(1)).get('component'),
    ) ?? entries[0];
  const [selected, setSelected] = useState(initial);
  const [filter, setFilter] = useState('');
  if (!selected) return null;
  function select(entry: T) {
    setSelected(entry);
    const url = new URL(location.href);
    url.hash = new URLSearchParams({ component: entry.id }).toString();
    history.replaceState(null, '', url);
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <nav
        aria-label="Components"
        className="hidden w-64 shrink-0 flex-col gap-3 bg-card p-4 md:flex"
      >
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Find component"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find component"
          />
        </InputGroup>
        <ul className="min-h-0 overflow-y-auto">
          {entries
            .filter((item) => item.name.toLowerCase().includes(filter.toLowerCase()))
            .map((item) => (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  className="h-9 w-full justify-start font-normal aria-[current=true]:bg-accent"
                  aria-current={item.id === selected.id}
                  onClick={() => select(item)}
                >
                  {item.name}
                </Button>
              </li>
            ))}
        </ul>
      </nav>
      <section
        aria-label="Component preview"
        className="min-w-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8"
      >
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 md:hidden">
            <NativeSelect
              className="w-full"
              aria-label="Component"
              value={selected.id}
              onChange={(e) => {
                const item = entries.find((x) => x.id === e.target.value);
                if (item) select(item);
              }}
            >
              {entries.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {children(selected)}
        </div>
      </section>
    </div>
  );
}
function GeneralPreview({ id }: { id: GeneralComponentId }) {
  const [mode, setMode] = useState<SpecimenMode>('ready');
  const entry = generalCatalog.find((item) => item.id === id)!;
  const Specimen = generalSpecimens[id];
  return (
    <>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium tracking-tight">{entry.name}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {entry.purpose}
          </p>
        </div>
        <NativeSelect
          aria-label="Preview state"
          value={mode}
          onChange={(e) => {
            if (
              e.target.value === 'ready' ||
              e.target.value === 'disabled' ||
              e.target.value === 'error'
            )
              setMode(e.target.value);
          }}
        >
          <NativeSelectOption value="ready">Ready</NativeSelectOption>
          <NativeSelectOption value="disabled">Disabled</NativeSelectOption>
          <NativeSelectOption value="error">Error</NativeSelectOption>
        </NativeSelect>
      </div>
      <div data-specimen={id} data-mode={mode} className="min-w-0 rounded-2xl bg-card p-5 sm:p-8">
        <Specimen mode={mode} />
      </div>
    </>
  );
}
export default function SystemWorkbench() {
  return (
    <main id="system" className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Component workbench</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Pebble Crew · local samples · {catalogSnapshot}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {generalCatalog.length} components · {aiCatalog.length} AI patterns
        </span>
      </header>
      <Tabs defaultValue="general" className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="mx-5 mb-3 w-auto! sm:mx-8">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ai">AI elements</TabsTrigger>
          <TabsTrigger value="private">Private requests</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="flex min-h-0 min-w-0 flex-1">
          <Catalog entries={generalCatalog}>
            {(entry) => <GeneralPreview key={entry.id} id={entry.id} />}
          </Catalog>
        </TabsContent>
        <TabsContent value="ai" className="flex min-h-0 min-w-0 flex-1">
          <Catalog entries={aiCatalog}>
            {(entry) => (
              <>
                <h2 className="text-xl font-medium tracking-tight">{entry.name}</h2>
                <p className="mt-2 mb-5 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  {entry.activation}
                </p>
                <AISpecimenPreview key={entry.id} id={entry.id} />
              </>
            )}
          </Catalog>
        </TabsContent>
        <TabsContent value="private" className="min-h-0 flex-1 overflow-auto p-5 sm:p-8">
          <div className="mx-auto max-w-2xl">
            <PrivateRequestSpecimen />
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
