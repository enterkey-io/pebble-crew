import { describe, expect, it } from 'vitest';
import { decodeExchange, decodeExchangeReferences } from './exchanges';
const participants = [
  { id: 'a', profile: 'aurora', name: 'Aurora' },
  { id: 'b', profile: 'chloe', name: 'Chloe' },
];
describe('private exchange boundary', () => {
  it('accepts only visible messages from authenticated participants', () => {
    const value = decodeExchange({
      id: 'exchange',
      state: 'completed',
      participants,
      messages: [
        {
          id: '1',
          author: 'b',
          text: 'Visible reply',
          created_at: 123,
          analysis: 'hidden',
          secret: 'excluded',
        },
      ],
      analysis: 'hidden',
    });
    expect(value.messages).toEqual([
      { id: '1', author: 'b', text: 'Visible reply', createdAt: 123 },
    ]);
    expect(() =>
      decodeExchange({
        ...value,
        messages: [{ id: '1', author: 'owner', text: 'wrong author', created_at: 123 }],
      }),
    ).toThrow();
  });
  it('rejects malformed reference counts and preserves exact native receipt timestamps', () => {
    const ref = {
      id: 'x',
      created_at: 100,
      count: 2,
      peer: participants[1],
      state: 'queued',
      tool_receipts: [{ call_id: 'same-call', timestamp: 123.25 }],
    };
    expect(decodeExchangeReferences({ exchanges: [ref] })[0]?.toolReceipts).toEqual([
      { callId: 'same-call', timestamp: 123.25 },
    ]);
    for (const count of [-1, 1.5, '2'])
      expect(() => decodeExchangeReferences({ exchanges: [{ ...ref, count }] })).toThrow();
    expect(() =>
      decodeExchangeReferences({
        exchanges: [{ ...ref, tool_receipts: [{ call_id: 'x', timestamp: NaN }] }],
      }),
    ).toThrow();
  });
});
