import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { sourceContract } from './ui-source-contract.mjs';

const revision = process.argv[2];
const errors = [];
function read(path) {
  try {
    return revision
      ? execFileSync('git', ['show', `${revision}:${path}`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      : readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
function requireRule(condition, message) {
  if (!condition) errors.push(message);
}
const main = read('apps/web/src/main.tsx');
const review = read('apps/web/src/ui-lab/main.tsx');
const theme = read('apps/web/src/ui/theme.css');
requireRule(main.includes("import './ui/theme.css'"), 'The installed app must load ui/theme.css.');
requireRule(
  /import ['"]\.\.\/main['"]/.test(review) && !/createRoot|UiReview|\.css['"]/.test(review),
  'The review entry must reuse the installed app entry; do not build a second set of review screens.',
);
for (const sheet of ['foundation', 'layout', 'product']) {
  requireRule(theme.includes(`./${sheet}.css`), `The shared theme must include ${sheet}.css.`);
}
for (const sheet of ['layout', 'product', 'org-chart', 'work']) {
  requireRule(
    theme.includes(`'./${sheet}.css' layer(components)`),
    `${sheet}.css must stay in the components layer so shared kit utilities own control appearance and states.`,
  );
}
requireRule(
  !read('apps/web/src/ui/product.css').includes('.danger-text'),
  'Remove danger-text; use Button destructive or destructive-ghost variants.',
);
requireRule(
  !/\.product-dialog\s*\{/.test(read('apps/web/src/ui/product.css')),
  'Dialog geometry belongs in DialogContent size variants, not a product CSS override.',
);
requireRule(
  !/\.product-sheet\s*\{/.test(read('apps/web/src/ui/product.css')),
  'Sheet geometry belongs in SheetContent size variants, not product CSS.',
);
for (const [path, source] of [
  ['App.tsx', './ui/DiscardChanges'],
  ['PebbleEditor.tsx', './ui/DiscardChanges'],
  ['NewPebble.tsx', './ui/DiscardChanges'],
  ['ui/OrganizationRail.tsx', './DiscardChanges'],
]) {
  const text = read('apps/web/src/' + path);
  requireRule(
    sourceContract(text).renders('DiscardChanges', source) &&
      !text.includes('Discard unsaved changes?'),
    `${path} must render the shared DiscardChanges AlertDialog; do not copy another confirmation.`,
  );
}
requireRule(
  !/^\s*:focus-visible\s*[{,]/m.test(read('apps/web/src/ui/product.css')),
  'Global focus rules belong in the base layer in foundation.css; product.css must not override primitive focus styles.',
);
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(directory + '/' + entry.name) : [directory + '/' + entry.name],
  );
}
const frontendFiles = revision
  ? execFileSync('git', ['ls-tree', '-r', '--name-only', revision, 'apps/web/src'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
  : sources('apps/web/src');
for (const path of frontendFiles.filter((path) => /\.tsx?$/.test(path))) {
  if (
    [
      'apps/web/src/main.tsx',
      'apps/web/src/avatar-lab/main.tsx',
      'apps/web/src/avatar-lab/main.ts',
    ].includes(path)
  )
    continue;
  requireRule(
    !/import\s+(?:[^'";]+from\s+)?['"][^'"]+\.css['"]/.test(read(path)),
    `${path}: import component styles through ui/theme.css, never through a TS module; earlier CSS can reverse layer ordering.`,
  );
}
const rail = read('apps/web/src/ui/OrganizationRail.tsx') + read('apps/web/src/chat/Rail.tsx');
requireRule(
  !read('apps/web/src/ui/layout.css').includes('#8e859d'),
  'Composer focus must use the neutral --ring token, not the old hard-coded lavender.',
);
requireRule(
  !/GripVertical|pc-section-empty|label: ['"]Move (?:up|down|earlier)['"]/.test(rail),
  'Drag whole rows; do not reintroduce exposed handles, empty-section instructions, or reorder menu clutter.',
);
requireRule(
  sourceContract(read('apps/web/src/chat/Rail.tsx')).renders('PebbleTile', '../ui/PebbleTile'),
  'Pinned pebbles must use PebbleTile; default Button icon/layout rules cannot own avatar cards.',
);
for (const path of ['NewPebble.tsx', 'ExistingPebbleSetup.tsx', 'PebbleEditor.tsx']) {
  const contract = sourceContract(read(`apps/web/src/${path}`));
  requireRule(
    contract.renders('PebbleProfileFields', './ui/pebble-profile-fields'),
    `${path} must use shared profile fields so name, avatar, title and description cannot diverge.`,
  );
  requireRule(
    contract.renders('ReportingField', './ui/pebble-profile-fields') &&
      contract.renders('RoleDetails', './ui/pebble-profile-fields'),
    `${path} must expose shared reporting and detailed role controls.`,
  );
  requireRule(
    contract.ownsProfileSession(),
    `${path} must use profileReducer; controls and editing ownership must stay shared.`,
  );
  requireRule(
    !contract
      .rawOperations()
      .some((operation) =>
        [
          'workspace.describe',
          'agent.onboard',
          'bots.profile.update',
          'roles.update',
          'agent.capabilities',
        ].includes(operation),
      ),
    `${path} must use WorkspaceDomain for profile reads and writes; do not cast transport results in the UI.`,
  );
  requireRule(
    !contract.unsupportedImports().length,
    `${path} must use supported package exports, not legacy workspace or internal source imports.`,
  );
}
if (errors.length) {
  for (const message of errors) console.error(`UI contract: ${message}`);
  process.exitCode = 1;
} else
  console.log(
    'UI contracts passed: one app, one theme, shared profile forms and whole-row interaction.',
  );
