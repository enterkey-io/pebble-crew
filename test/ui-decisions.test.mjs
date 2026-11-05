import { expect, test } from 'vitest';
import { reviewUiDiff } from '../scripts/check-ui-decisions.mjs';

const heading = '## Decision log';
const entry = (id) => `### ${id} Shared layout

- Date: 2026-11-05
- Decision: Use the same page header.
- Why: The close control needs a stable location.
- Evidence: Exercise the installed phone page.
`;
const before = `# Standards\n\n${heading}\n\n${entry('UI-page-header')}`;
const paths = ['apps/web/src/WorkspaceSettings.tsx'];

test('a web UI change requires a new decision or a valid existing rule with a reason', () => {
  expect(() => reviewUiDiff({ before, after: before, paths })).toThrow('Append a new decision');
  for (const description of [
    'UI unchanged: UI-page-header.',
    'UI unchanged: UI-unknown. Same controls.',
    '<!-- UI unchanged: UI-page-header. Same controls. -->',
  ]) {
    expect(() => reviewUiDiff({ before, after: before, paths, description })).toThrow(
      'Append a new decision',
    );
  }
  expect(
    reviewUiDiff({
      before,
      after: before,
      paths,
      description:
        'UI unchanged: UI-page-header. The editor moved files and renders the same header.',
    }),
  ).toContain('UI unchanged under UI-page-header');
});

test('a new complete entry records a UI decision even before the implementation changes', () => {
  const after = `${before}\n${entry('UI-focus-return')}`;
  expect(reviewUiDiff({ before, after })).toContain('UI-focus-return');
  expect(() =>
    reviewUiDiff({ before, after: `${before}\n### UI-incomplete Missing detail` }),
  ).toThrow('needs a date, decision, reason, and evidence');
  expect(() => reviewUiDiff({ before, after: `${before}\n${entry('UI-page-header')}` })).toThrow(
    'Invalid or duplicate decision ID',
  );
});

test('superseded decisions remain readable and release metadata does not need a UI decision', () => {
  const after = `# Standards\n\n${heading}\n\n${entry('UI-new-header')}`;
  expect(() => reviewUiDiff({ before, after })).toThrow('Keep UI-page-header in the decision log');
  expect(
    reviewUiDiff({
      before,
      after: before,
      paths: ['release.json', 'apps/web/public/version.json', 'apps/web/src/ui/example.test.ts'],
    }),
  ).toBe('No web UI or standards files changed.');
  expect(() =>
    reviewUiDiff({ before, after: before, paths: ['apps/web/public/icons/pebble.svg'] }),
  ).toThrow('Append a new decision');
});
