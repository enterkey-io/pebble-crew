import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { LoadingBar } from '../components/ui/loading-bar';

type Preview = { kind: 'image'; url: string } | { kind: 'error' };

// An SVG image has its own stylesheet and inherits the viewer's color scheme.
const diagramStyle = `<style>
  @media (prefers-color-scheme: dark) {
    .pele {
      --pele-bg: #111113;
      --pele-fg: #eeeeef;
      --pele-line: #a4a3ad;
      --pele-muted: #a4a3ad;
      --pele-surface: #202023;
      --pele-surface-alt: #27272b;
      --pele-border: #484650;
    }
  }
</style>`;

export function DiagramPreview({ source }: { source: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [maxWidth, setMaxWidth] = useState<number>();
  const [result, setResult] = useState<{ source: string; preview: Preview }>();
  const preview = result?.source === source ? result.preview : undefined;

  useEffect(() => {
    const container = viewport.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout>;
    const measure = () => {
      if (container.clientWidth > 0) setMaxWidth(container.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 140);
    });
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!maxWidth) return;
    let active = true;
    let url: string | undefined;
    void import('pele/lazy')
      .then(({ renderAsync }) =>
        active ? renderAsync(source, { maxWidth, links: false, images: false }) : undefined,
      )
      .then((rendered) => {
        if (!active || !rendered) return;
        // Display generated SVG as an image, outside the application's DOM.
        const svg = rendered.svg.replace(/^(<svg\b[^>]*>)/, `$1${diagramStyle}`);
        url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        setResult({ source, preview: { kind: 'image', url } });
      })
      .catch(() => {
        if (active) setResult({ source, preview: { kind: 'error' } });
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, maxWidth]);

  return (
    <figure className="my-4 min-w-0 space-y-2">
      <div ref={viewport} className="overflow-x-auto rounded-lg border border-border bg-background">
        {!preview && <LoadingBar active label="Rendering diagram" />}
        {preview?.kind === 'image' && (
          <img
            className="mx-auto block max-w-none"
            src={preview.url}
            alt="Mermaid diagram"
            onError={() => setResult({ source, preview: { kind: 'error' } })}
          />
        )}
        {preview?.kind === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>
              This diagram couldn’t be rendered. See its source below.
            </AlertDescription>
          </Alert>
        )}
      </div>
      <details
        className="text-sm text-muted-foreground"
        open={preview?.kind === 'error' || undefined}
      >
        <summary className="cursor-pointer">Diagram source</summary>
        <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 font-mono text-foreground">
          {source}
        </pre>
      </details>
    </figure>
  );
}
