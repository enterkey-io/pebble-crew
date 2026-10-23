import { describe, it, expect, vi } from 'vitest';
import { RequestDomain } from './request-domain';

describe('conversation request boundary', () => {
  it('retains the stored request creation time separately from decision state', async () => {
    const request = {
      id: 'r',
      actor: 'arlo',
      action: 'agent.attach',
      state: 'completed',
      spec: {},
      created: 1700000000.125,
    };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ requests: [request] })
      .mockResolvedValueOnce({ requests: [{ ...request, state: 'pending', created: undefined }] })
      .mockResolvedValueOnce({ requests: [{ ...request, created: 'yesterday' }] });
    const domain = new RequestDomain({ invoke });
    expect((await domain.list())[0]?.createdAt).toBe(1700000000125);
    expect((await domain.list())[0]?.createdAt).toBeUndefined();
    await expect(domain.list()).rejects.toThrow();
  });
  it('decides only the exact request fingerprint and retains deletion confirmation', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        requests: [
          {
            id: 'r',
            actor: 'mica',
            action: 'agent.delete',
            state: 'pending',
            fingerprint: 'intent',
            spec: { profile: 'mica' },
          },
        ],
      })
      .mockResolvedValueOnce({ state: 'completed' });
    const domain = new RequestDomain({ invoke });
    const [request] = await domain.list();
    expect(await domain.decide(request!, true, 'DELETE mica')).toEqual({
      state: 'completed',
      result: null,
    });
    expect(invoke).toHaveBeenLastCalledWith('requests.approve', {
      id: 'r',
      fingerprint: 'intent',
      confirmation: 'DELETE mica',
    });
  });
  it('retains failure reasons and rejects unknown or malformed decision receipts', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        requests: [
          {
            id: 'r',
            actor: 'arlo',
            action: 'agent.create',
            state: 'pending',
            fingerprint: 'exact',
            spec: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        state: 'failed',
        result: { code: 'AUTH_MISSING', error: 'Sign in to Codex in Hermes.' },
      })
      .mockResolvedValueOnce({ state: 'surprise' })
      .mockResolvedValueOnce({ state: 'completed', result: 'unverified' });
    const domain = new RequestDomain({ invoke });
    const [request] = await domain.list();
    expect(await domain.decide(request!, true)).toEqual({
      state: 'failed',
      result: { code: 'AUTH_MISSING', error: 'Sign in to Codex in Hermes.' },
    });
    await expect(domain.decide(request!, true)).rejects.toThrow();
    await expect(domain.decide(request!, true)).rejects.toThrow();
  });
  it('preserves native multiple-choice and locked-answer state', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        requests: [
          {
            id: 'q',
            answers: { q0: 'Research' },
            questions: [
              { qid: 'q0', question: 'Project?', choices: ['Research'], multi_select: false },
              {
                qid: 'q1',
                question: 'Sources?',
                choices: ['Official', 'Papers'],
                multi_select: true,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ state: 'expired' });
    const domain = new RequestDomain({ invoke });
    const [request] = await domain.questions('chat-mica');
    expect(request!.questions.map((q) => [q.id, q.multiple, q.answered])).toEqual([
      ['q0', false, true],
      ['q1', true, false],
    ]);
    expect(await domain.answer('chat-mica', 'q', 'q1', ['Official', 'Papers'])).toBe('expired');
    expect(invoke).toHaveBeenLastCalledWith('questions.respond', {
      session_id: 'chat-mica',
      id: 'q',
      question_id: 'q1',
      answer: ['Official', 'Papers'],
    });
  });
  it('rejects malformed cards and unconfirmed answer receipts', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        requests: [
          {
            id: 'bad',
            answers: {},
            questions: [{ qid: 'q', question: 'Project?', choices: [123] }],
          },
        ],
      })
      .mockResolvedValueOnce({ state: 'queued' });
    const domain = new RequestDomain({ invoke });
    await expect(domain.questions('chat')).rejects.toThrow();
    await expect(domain.answer('chat', 'bad', 'q', 'Research')).rejects.toThrow();
  });
});

describe('complete approval discovery', () => {
  it('drains bounded pending pages without letting recent receipts truncate pending work', async () => {
    const pending = Array.from({ length: 205 }, (_, i) => ({
      id: 'p' + i,
      actor: 'aurora',
      action: 'agent.attach',
      state: 'pending',
      fingerprint: 'f' + i,
      spec: {},
    }));
    const invoke = vi.fn(async (_operation: string, params: Record<string, unknown>) => {
      const offset = Number(params.cursor ?? 0),
        found = pending.slice(offset, offset + 25);
      return params.view === 'recent'
        ? { requests: [], generation: 1, next: null }
        : {
            requests: found,
            generation: 1,
            next: offset + 25 < pending.length ? String(offset + 25) : null,
          };
    });
    const read = await new RequestDomain({ invoke }).read();
    expect(read.requests).toHaveLength(205);
    expect(read.faults).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(10);
  });
  it('isolates malformed rows and retains healthy decisions while exposing a fault', async () => {
    const good = {
      id: 'ron',
      actor: 'aurora',
      action: 'agent.create',
      state: 'pending',
      fingerprint: 'exact',
      spec: {},
    };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        requests: [good, { ...good, id: 'bad', spec: [] }],
        generation: 1,
        next: null,
      })
      .mockResolvedValueOnce({ requests: [], next: null });
    const result = await new RequestDomain({ invoke }).read();
    expect(result.requests.map((row) => row.id)).toEqual(['ron']);
    expect(result.faults.map((row) => row.id)).toEqual(['bad']);
  });
  it('restarts a changed scan and retrieves exact IDs without searching history', async () => {
    const row = { id: 'old', actor: 'aurora', action: 'agent.attach', state: 'pending', spec: {} };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ restart: true })
      .mockResolvedValueOnce({ generation: 2, requests: [row], next: null })
      .mockResolvedValueOnce({ requests: [], next: null })
      .mockResolvedValueOnce({ request: row });
    const domain = new RequestDomain({ invoke });
    expect((await domain.read()).requests[0]?.id).toBe('old');
    expect((await domain.get('old'))?.state).toBe('pending');
    expect(invoke).toHaveBeenLastCalledWith('requests.get', { id: 'old' });
  });
});
