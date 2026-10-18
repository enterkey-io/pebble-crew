import type { Plugin } from 'vite';
import { initializeAppearance } from '../apps/web/src/ui/appearance-bootstrap';

export function appearancePlugin(): Plugin {
  const source = `(${initializeAppearance.toString()})();`;
  return {
    name: 'appearance-startup',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (context.path.endsWith('avatar-lab.html')) return html;
        return [{ tag: 'script', attrs: { src: '/appearance-init.js' }, injectTo: 'head' }];
      },
    },
    configureServer(server) {
      server.middlewares.use('/appearance-init.js', (_request, response) => {
        response.setHeader('Content-Type', 'application/javascript');
        response.end(source);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'appearance-init.js', source });
    },
  };
}
