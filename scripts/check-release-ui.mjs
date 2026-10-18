import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.env.WORKSPACE_BUILD_ROOT
  ? resolve(process.env.WORKSPACE_BUILD_ROOT, 'web')
  : resolve('apps/web/dist');
const assets = await readdir(resolve(root, 'assets'));
for (const name of assets.filter((name) => name.endsWith('.js'))) {
  const source = await readFile(resolve(root, 'assets', name), 'utf8');
  if (
    /SystemWorkbench/.test(name) ||
    /Component workbench|data-ai-specimen|data-specimen/.test(source)
  )
    throw new Error(`The normal release includes the component workbench: ${name}`);
}
const release = JSON.parse(await readFile('release.json', 'utf8'));
const built = JSON.parse(await readFile(resolve(root, 'version.json'), 'utf8'));
if (built.version !== release.version || built.tag !== release.tag)
  throw new Error('Built UI version does not match the candidate release.');
console.log(`Release UI verified: ${built.version}; component workbench excluded.`);
