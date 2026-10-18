import { ExternalLink } from 'lucide-react';
import { Activity } from './activity';
import { Resource } from './resource';
import { safeSourceHref, type ResourceState } from './states';
export type Source = {
  readonly id: string;
  readonly title: string;
  readonly href?: string;
  readonly description?: string;
};
export function Sources({ value }: { value: ResourceState<readonly Source[]> }) {
  return (
    <Resource value={value} empty="No sources">
      {(sources) => (
        <Activity
          title={`${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`}
          state="complete"
        >
          <ul className="grid gap-3">
            {sources.map((source) => {
              const href = source.href ? safeSourceHref(source.href) : undefined;
              return (
                <li key={source.id} className="min-w-0 text-sm">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-2 text-foreground underline-offset-4 hover:underline"
                    >
                      <span className="truncate">{source.title}</span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    <span>{source.title}</span>
                  )}
                  {source.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{source.description}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </Activity>
      )}
    </Resource>
  );
}
