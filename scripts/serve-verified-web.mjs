import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assertWebBuild } from './web-build-proof.mjs';
if (process.env.WORKSPACE_BUILD_ROOT) {
  const directory = resolve(process.env.WORKSPACE_BUILD_ROOT, 'web');
  const version = JSON.parse(readFileSync(resolve(directory, 'version.json'), 'utf8'));
  console.log(`Testing explicit packaged web artifact ${version.version} from ${directory}`);
} else {
  assertWebBuild(resolve('apps/web/dist'));
}
await import('./serve-static.mjs');
