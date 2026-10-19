// Verify one existing package before publishing; never deploy or update an owner host.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';

for (const name of ['HERMES_NATIVE_ROOT', 'HERMES_NATIVE_PYTHON']) {
  const value = process.env[name];
  if (!value || !isAbsolute(value))
    throw new Error(`Set ${name} to an explicit isolated native test installation.`);
  await stat(value);
}
const archive = resolve(
  process.env.WORKSPACE_PLUGIN_ARCHIVE ?? 'artifacts/packages/workspace-plugin-preview.zip',
);
const digest = async () =>
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
const before = await digest();
await mkdir('artifacts', { recursive: true });
const baseline = JSON.parse(await readFile('scripts/fixture/upgrade-baseline.json', 'utf8'));
const previousArchive = resolve('artifacts/upgrade-baseline.zip');
const response = await fetch(baseline.url, { signal: AbortSignal.timeout(90000) });
if (!response.ok)
  throw new Error('Cannot obtain the pinned previous release for upgrade acceptance.');
const previous = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(previous).digest('hex') !== baseline.sha256)
  throw new Error('Previous-release archive checksum differs from the pinned upgrade baseline.');
await writeFile(previousArchive, previous);
const evidence = resolve('artifacts/installed-package-acceptance.json');
const result = spawnSync(process.execPath, ['scripts/test-installed-plugin.mjs', evidence], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WORKSPACE_PLUGIN_ARCHIVE: archive,
    WORKSPACE_PREVIOUS_ARCHIVE: previousArchive,
  },
});
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error('Installed-package acceptance failed; release remains unverified.');
const report = JSON.parse(await readFile(evidence, 'utf8'));
if (!report.passed || report.package_sha256 !== before || (await digest()) !== before) {
  throw new Error('The verified package and final archive differ; run acceptance again.');
}
console.log(`Verified archive SHA256 ${before}. Evidence: ${evidence}`);
