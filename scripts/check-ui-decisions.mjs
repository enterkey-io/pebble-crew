import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const standards = 'docs/UI_STANDARDS.md';
const idPattern = 'UI-[a-z0-9]+(?:-[a-z0-9]+)*';
const generatedPublicFiles = new Set([
  'connection.json',
  'install.html',
  'install.md',
  'version.json',
]);

function isWebUi(path) {
  if (path.startsWith('apps/web/src/')) return !/\.(?:test|spec)\.[^/]+$/.test(path);
  if (path.startsWith('apps/web/public/')) {
    const name = path.slice('apps/web/public/'.length);
    return !generatedPublicFiles.has(name) && !name.startsWith('licenses/');
  }
  return /^apps\/web\/(?:index\.html|avatar-lab\.html|components\.json)$/.test(path);
}

function decisions(document) {
  const logStart = document.indexOf('\n## Decision log\n');
  if (logStart < 0) throw new Error(`${standards} needs a Decision log section.`);
  const log = document.slice(logStart);
  const headings = [...log.matchAll(/^### (UI-\S+) (\S.*)$/gm)];
  const records = new Set();
  for (const [i, heading] of headings.entries()) {
    const [, id] = heading;
    if (!new RegExp(`^${idPattern}$`).test(id) || records.has(id))
      throw new Error(`Invalid or duplicate decision ID: ${id}.`);
    const entry = log.slice(heading.index + heading[0].length, headings[i + 1]?.index);
    if (
      !/^- Date: \d{4}-\d{2}-\d{2}$/m.test(entry) ||
      !['Decision', 'Why', 'Evidence'].every((field) =>
        new RegExp(`^- ${field}: \\S`, 'm').test(entry),
      )
    ) {
      throw new Error(`${id} needs a date, decision, reason, and evidence in ${standards}.`);
    }
    records.add(id);
  }
  if (!records.size) throw new Error(`${standards} needs at least one decision entry.`);
  return records;
}

export function reviewUiDiff({ before, after, paths = [], description = '' }) {
  const current = decisions(after);
  if (before === undefined) return 'UI decision log is valid.';
  const previous = before ? decisions(before) : new Set();
  for (const id of previous) {
    if (!current.has(id))
      throw new Error(`Keep ${id} in the decision log. Add a new entry to supersede it.`);
  }
  const added = [...current].filter((id) => !previous.has(id));
  if (added.length) return `UI decisions recorded: ${added.join(', ')}.`;
  if (before === after && !paths.some(isWebUi)) return 'No web UI or standards files changed.';

  const unchanged = description
    .replaceAll('\r\n', '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .match(new RegExp(`^UI unchanged: (${idPattern})\\. (\\S.*)$`, 'm'));
  if (unchanged && current.has(unchanged[1])) {
    return `UI unchanged under ${unchanged[1]}. Review the reason against the diff.`;
  }
  throw new Error(
    `Append a new decision to ${standards}. If the design follows an existing rule without changing it, add "UI unchanged: UI-existing-id. Reason." to the PR description.`,
  );
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [base, head] = process.argv.slice(2);
    if (base && head) {
      const common = git(['merge-base', base, head]).trim();
      const paths = git(['diff', '--name-only', '--no-renames', '-z', common, head]).split('\0');
      const hadStandards = git(['ls-tree', '--name-only', common, standards]).trim();
      const before = hadStandards ? git(['show', `${common}:${standards}`]) : '';
      const after = git(['show', `${head}:${standards}`]);
      console.log(reviewUiDiff({ before, after, paths, description: process.env.PR_DESCRIPTION }));
    } else if (base || head) {
      throw new Error('Provide both the base and head commit.');
    } else {
      console.log(reviewUiDiff({ after: readFileSync(standards, 'utf8') }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
