import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
export function webSourceProof(root, files) {
  return {
    schema: 1,
    inputs: [...new Set(files)]
      .sort()
      .map((path) => ({ path, sha256: digest(resolve(root, path)) })),
  };
}
export function assertWebBuild(directory, root = process.cwd()) {
  const fail = (detail) => {
    throw new Error(
      `Production web build is stale: ${detail}. Run npm run build before browser verification.`,
    );
  };
  const path = resolve(directory, 'build-source.json');
  if (!existsSync(path)) return fail('build-source.json is missing');
  const proof = JSON.parse(readFileSync(path, 'utf8'));
  if (proof?.schema !== 1 || !Array.isArray(proof.inputs) || !proof.inputs.length)
    return fail('invalid source proof');
  for (const input of proof.inputs) {
    if (typeof input?.path !== 'string' || typeof input.sha256 !== 'string')
      return fail('invalid source input');
    const source = resolve(root, input.path);
    if (
      !source.startsWith(resolve(root) + sep) ||
      !existsSync(source) ||
      digest(source) !== input.sha256
    )
      return fail(input.path);
  }
}
export function webBuildProofPlugin() {
  const root = process.cwd();
  return {
    name: 'pebble-web-source-proof',
    generateBundle() {
      const files = [...this.getModuleIds()]
        .map((id) => id.split('?')[0])
        .filter(
          (id) =>
            id &&
            id.startsWith(root + sep) &&
            !id.includes(`${sep}node_modules${sep}`) &&
            existsSync(id) &&
            statSync(id).isFile(),
        )
        .map((id) => relative(root, id).split(sep).join('/'));
      function publicFiles(directory) {
        for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
          if (entry.name === 'downloads') continue;
          const path = `${directory}/${entry.name}`;
          if (entry.isDirectory()) publicFiles(path);
          else if (entry.isFile()) files.push(path);
        }
      }
      publicFiles('apps/web/public');
      files.push(
        'scripts/appearance-plugin.ts',
        'scripts/image-viewer-styles-plugin.ts',
        'package.json',
        'package-lock.json',
        'release.json',
        'tsconfig.json',
        'vite.web.config.ts',
        'scripts/web-build-proof.mjs',
        'apps/web/index.html',
      );
      this.emitFile({
        type: 'asset',
        fileName: 'build-source.json',
        source: JSON.stringify(webSourceProof(root, files)) + '\n',
      });
    },
  };
}
