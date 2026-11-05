import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fixedAppRoots } from '../scripts/mobile-shell-contract.mjs';

test('the mobile shell contract rejects the fixed-root rule from the released regression', () => {
  const old = execFileSync(
    'git',
    ['show', '1315af537a5eb6907aea6e626163b1fd35a6db92:apps/web/src/ui/layout.css'],
    { encoding: 'utf8' },
  );
  expect(fixedAppRoots(old)).toContain('.pc-shell');
  const current = ['layout', 'mobile', 'foundation', 'product']
    .map((name) => readFileSync(`apps/web/src/ui/${name}.css`, 'utf8'))
    .join('\n');
  expect(fixedAppRoots(current)).toEqual([]);
  expect(fixedAppRoots('.dialog { position: fixed; }')).toEqual([]);
});
