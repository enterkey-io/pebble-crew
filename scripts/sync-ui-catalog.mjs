import { readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { format } from 'prettier';

const source = await readFile('apps/web/src/ui-lab/catalog.ts', 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2023' });
const { generalCatalog, aiCatalog } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
for (const [name, entries, expected] of [
  ['general', generalCatalog, 73],
  ['AI', aiCatalog, 21],
]) {
  if (entries.length !== expected || new Set(entries.map((entry) => entry.id)).size !== expected) {
    throw new Error(`The pinned ${name} catalog must contain ${expected} unique entries.`);
  }
}
const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = (header, rows) =>
  [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
const path = 'docs/SHADCN_COVERAGE.md';
const before = await readFile(path, 'utf8');
if (
  !before.includes('| ID / unique pattern') ||
  !before.includes('## Legacy AI catalog dispositions')
) {
  throw new Error('Coverage document table boundaries changed; reconcile the generator.');
}
let after = before.replace(
  /\| ID \/ unique pattern[\s\S]*?(?=\nAll AI rows complete)/,
  table(
    [
      'ID / unique pattern',
      'Shared component and prepared state contract',
      'Native status / evidence',
      'Installed integration and activation rule',
    ],
    aiCatalog.map((entry, index) => [
      `AI${String(index + 1).padStart(2, '0')} ${entry.name}`,
      entry.contract,
      entry.evidence,
      entry.activation,
    ]),
  ) + '\n',
);
const heading = after.indexOf('## Complete general component vocabulary');
const prefix = after.slice(0, heading);
const rest = after.slice(heading).replace(
  /\| Component\s*\| Catalog[\s\S]*?(?=\nUtilities `shimmer`)/,
  table(
    ['Component', 'Catalog', 'Disposition and actual use'],
    generalCatalog.map((entry) => [
      entry.name,
      entry.catalog[0].toUpperCase() + entry.catalog.slice(1),
      entry.purpose,
    ]),
  ) + '\n',
);
after = await format(prefix + rest, { parser: 'markdown' });
if (process.argv.includes('--check')) {
  if (after !== before)
    throw new Error('Catalog tables are stale. Run node scripts/sync-ui-catalog.mjs.');
  process.stdout.write('Catalog coverage verified: 73 general entries and 21 AI patterns.\n');
} else {
  await writeFile(path, after);
  process.stdout.write('Coverage tables synchronized from the executable component catalog.\n');
}
