import { build } from 'esbuild';
import { resolve } from 'node:path';
const output = process.env.WORKSPACE_BUILD_ROOT
  ? resolve(process.env.WORKSPACE_BUILD_ROOT, 'owner/main.mjs')
  : 'apps/owner-node/dist/main.mjs';
await build({
  entryPoints: ['apps/owner-node/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  loader: { '.sql': 'text' },
  outfile: output,
});
