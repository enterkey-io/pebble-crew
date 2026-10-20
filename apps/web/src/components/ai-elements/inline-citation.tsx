import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { safeSourceHref } from './states';
export type CitationSource =
  | { kind: 'unavailable'; label: string }
  | { kind: 'plain'; label: string; description: string }
  | { kind: 'linked'; label: string; description: string; href: string };
export function InlineCitation({ source }: { source: CitationSource }) {
  if (source.kind === 'unavailable')
    return <span className="text-xs text-muted-foreground">{source.label}</span>;
  const href = source.kind === 'linked' ? safeSourceHref(source.href) : undefined;
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex min-h-6 items-center rounded px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`Source: ${source.label}`}
      >
        {source.label}
      </PopoverTrigger>
      <PopoverContent className="max-w-[calc(100vw-2rem)] text-sm">
        <p className="font-medium">{source.label}</p>
        <p className="mt-1 text-muted-foreground">{source.description}</p>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block underline underline-offset-4"
          >
            Open source
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
