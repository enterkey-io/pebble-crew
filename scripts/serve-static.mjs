import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const builtDirectory = resolve(scriptDirectory, '../apps/web/dist');
const root = resolve(
  process.env.BOT_WEB_STATIC_DIRECTORY ??
    (existsSync(resolve(scriptDirectory, 'index.html')) ? scriptDirectory : builtDirectory),
);
const downloads = existsSync(resolve(root, 'downloads'))
  ? resolve(root, 'downloads')
  : resolve(scriptDirectory, '../artifacts/packages');
const downloadable = new Set([
  'workspace-owner-preview.zip',
  'workspace-web-preview.zip',
  'workspace-plugin-preview.zip',
  'workspace-source-preview.zip',
  'workspace-site-preview.zip',
  'workspace-manifest.json',
  'SHA256SUMS',
]);
const headerFile = await readFile(resolve(root, '_headers'), 'utf8');
const headers = Object.fromEntries(
  headerFile
    .split('\n')
    .filter((line) => line.startsWith('  '))
    .map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const url = new URL(request.url, 'http://static.invalid');
    if (url.search || url.pathname === '/_headers') {
      response.writeHead(400).end();
      return;
    }
    const path = resolve(
      root,
      '.' +
        decodeURIComponent(
          url.pathname === '/' || url.pathname === '/system'
            ? '/index.html'
            : url.pathname === '/install'
              ? '/install.html'
              : url.pathname,
        ),
    );
    if (url.pathname.startsWith('/downloads/')) {
      const name = url.pathname.slice('/downloads/'.length);
      if (!downloadable.has(name)) {
        response.writeHead(404).end();
        return;
      }
      const data = await readFile(resolve(downloads, name));
      response.setHeader(
        'Content-Type',
        name.endsWith('.zip')
          ? 'application/zip'
          : name === 'SHA256SUMS'
            ? 'text/plain; charset=utf-8'
            : 'application/json',
      );
      response.setHeader('Content-Length', data.length);
      if (name.endsWith('.zip'))
        response.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      response.writeHead(200).end(request.method === 'HEAD' ? undefined : data);
      return;
    }
    if (!path.startsWith(root + sep) || !Object.hasOwn(mime, extname(path))) {
      response.writeHead(404).end();
      return;
    }
    const data = await readFile(path);
    response.setHeader('Content-Type', mime[extname(path)]);
    response.setHeader('Content-Length', data.length);
    response.writeHead(200).end(request.method === 'HEAD' ? undefined : data);
  } catch {
    response.writeHead(404).end();
  }
});
// No access logging, proxying, forms, analytics, cookies or data routes.
server.listen(
  Number(process.env.BOT_WEB_STATIC_PORT ?? 8080),
  process.env.BOT_WEB_STATIC_HOST ?? '127.0.0.1',
);
