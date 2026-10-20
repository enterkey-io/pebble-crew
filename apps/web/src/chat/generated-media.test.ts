import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import corpus from '../../../../test/fixtures/media-references.json';
import { localReference, referenceKey } from './generated-media';

describe('saved assistant media addressing', () => {
  it('matches the native strict one-decode UTF-8 reference corpus', async () => {
    for (const { source, normalized } of corpus.valid)
      expect(await referenceKey(source)).toBe(
        createHash('sha256').update(normalized).digest('hex'),
      );
    for (const source of corpus.invalid) await expect(referenceKey(source)).rejects.toThrow();
  });
  it('does not treat remote URLs or active schemes as local media', () => {
    for (const source of [
      'https://tracker.test/a.png',
      '//tracker.test/a.png',
      'javascript:alert(1)',
      'data:image/png;base64,x',
      '#notes',
      'mailto:owner@example.test',
    ])
      expect(localReference(source)).toBe(false);
    expect(localReference('/home/hermes/cache/generated/report.csv')).toBe(true);
    expect(localReference('file:///home/hermes/cache/images/chart.png')).toBe(true);
  });
});
