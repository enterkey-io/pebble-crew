import type { Plugin } from 'vite';

// Keep the pinned library's CSS in an external asset under style-src 'self'.
export function imageViewerStylesPlugin(): Plugin {
  const stylesheetId = 'virtual:pebble-image-viewer.css';
  const resolvedId = `\0${stylesheetId}`;
  let stylesheet = '';
  return {
    name: 'image-viewer-styles',
    enforce: 'pre',
    apply: 'build',
    resolveId(id) {
      if (id === stylesheetId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) return stylesheet;
    },
    transform(source, id) {
      if (!id.endsWith('/react-zoom-pan-pinch/dist/index.esm.js')) return;
      const matches = [...source.matchAll(/var (css_\w+) = ("(?:\\.|[^"\\])*");/g)];
      const match = matches[0];
      if (matches.length !== 1 || !match?.[1] || !match[2])
        return this.error(
          'Photo zoom styles changed; revalidate the pinned package before building.',
        );
      const injection = `styleInject(${match[1]});`;
      if (source.split(injection).length !== 2)
        return this.error('Photo zoom style injection changed; revalidate the pinned package.');
      stylesheet = JSON.parse(match[2]) as string;
      return source.replace(match[0], '').replace(injection, `import '${stylesheetId}';`);
    },
  };
}
