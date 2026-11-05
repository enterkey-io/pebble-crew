import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { assertWebBuild, webSourceProof } from '../scripts/web-build-proof.mjs';

test('browser verification rejects an old bundle after a product source change', () => {
  const root = mkdtempSync(join(tmpdir(), 'pebble-build-proof-'));
  try {
    const output = join(root, 'dist');
    mkdirSync(output);
    writeFileSync(join(root, 'body.css'), 'p { font-size: 15px }');
    expect(() => assertWebBuild(output, root)).toThrow('Run npm run build');
    writeFileSync(
      join(output, 'build-source.json'),
      JSON.stringify(webSourceProof(root, ['body.css'])),
    );
    expect(() => assertWebBuild(output, root)).not.toThrow();
    writeFileSync(join(root, 'body.css'), 'p { font-size: 16px }');
    expect(() => assertWebBuild(output, root)).toThrow('body.css');
    writeFileSync(
      join(output, 'build-source.json'),
      JSON.stringify(webSourceProof(root, ['body.css'])),
    );
    expect(() => assertWebBuild(output, root)).not.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
