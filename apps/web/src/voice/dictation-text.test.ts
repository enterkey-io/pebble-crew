import { describe, expect, it } from 'vitest';
import { markSent, nothingSent, pendingText } from './dictation-text';

const result = (transcript: string, final = true) => ({ transcript, final });

describe('dictation text', () => {
  it('shows everything heard before the first send', () => {
    expect(pendingText([result('Add milk'), result(' to the', false)], nothingSent)).toBe(
      'Add milk to the',
    );
  });

  it('shows only new results after a send', () => {
    const before = [result('Add milk to the list.')];
    const sent = markSent(before);
    expect(pendingText([...before, result(' And eggs', false)], sent)).toBe('And eggs');
  });

  it('trims sent words when Safari keeps growing the same result', () => {
    const sent = markSent([result('Add milk to the list', false)]);
    expect(pendingText([result('Add milk to the list and eggs', false)], sent)).toBe('and eggs');
  });

  it('does not resend a result that was revised after it was sent', () => {
    const sent = markSent([result('Add milk to the list', false)]);
    expect(pendingText([result('Add milk to the list.')], sent)).toBe('');
    expect(pendingText([result('Add milk to the list.'), result('Thanks', false)], sent)).toBe(
      'Thanks',
    );
  });
});
