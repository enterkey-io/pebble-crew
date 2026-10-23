import { ClientError } from '@hermes-client/core';
import type { SessionClient } from './session-client';
import { record } from './json';

function text(value: unknown, limit = 8000): string {
  if (typeof value !== 'string' || value.length > limit) throw new ClientError('INVALID_RESPONSE');
  return value;
}
function list<T>(value: unknown, decode: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 100) throw new ClientError('INVALID_RESPONSE');
  return value.map(decode);
}
function decodeRequest(value: unknown) {
  const row = record(value);
  if (
    row.created != null &&
    (typeof row.created !== 'number' || !Number.isFinite(row.created) || row.created < 0)
  )
    throw new ClientError('INVALID_RESPONSE');
  return {
    id: text(row.id, 128),
    actor: row.actor == null ? null : text(row.actor, 128),
    action: text(row.action, 128),
    state: text(row.state, 64),
    fingerprint: row.fingerprint == null ? '' : text(row.fingerprint, 128),
    spec: record(row.spec),
    result: row.result == null ? null : record(row.result),
    createdAt: typeof row.created === 'number' ? row.created * 1000 : undefined,
  };
}
export type WorkspaceRequest = ReturnType<typeof decodeRequest>;
export type RequestFault = { id: string | null; message: string };
export type RequestRead = { requests: WorkspaceRequest[]; faults: RequestFault[] };
export type ManagementReview =
  | {
      kind: 'ready';
      digest: string;
      legacy: boolean;
      currentContext: boolean;
      manager: string | null;
      managerIdentity: string | null;
    }
  | { kind: 'blocked'; reason: string }
  | { kind: 'outcome' };
function decodeRows(values: unknown): RequestRead {
  if (!Array.isArray(values) || values.length > 100) throw new ClientError('INVALID_RESPONSE');
  const requests: WorkspaceRequest[] = [],
    faults: RequestFault[] = [];
  for (const value of values) {
    try {
      requests.push(decodeRequest(value));
    } catch {
      const id =
        value &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        value.id.length <= 128
          ? value.id
          : null;
      faults.push({ id, message: 'A request could not be read. Retry to check it.' });
    }
  }
  return { requests, faults };
}
function decodeQuestionRequest(value: unknown) {
  const row = record(value),
    answers = record(row.answers);
  return {
    id: text(row.id, 128),
    questions: list(row.questions, (value) => {
      const question = record(value),
        id = text(question.qid, 128);
      return {
        id,
        title: text(question.question),
        choices:
          question.choices == null ? [] : list(question.choices, (value) => text(value, 1000)),
        multiple: question.multi_select === true,
        answered: Object.hasOwn(answers, id),
      };
    }),
  };
}
export type QuestionRequest = ReturnType<typeof decodeQuestionRequest>;
export class RequestDomain {
  constructor(private readonly bridge: Pick<SessionClient, 'invoke'>) {}
  async list() {
    return list(record(await this.bridge.invoke('requests.list', {})).requests, decodeRequest);
  }
  async read(): Promise<RequestRead> {
    // Restart the whole scan if another process changes the journal between pages.
    for (let attempt = 0; attempt < 3; attempt++) {
      let cursor: string | null = null;
      const requests: WorkspaceRequest[] = [],
        faults: RequestFault[] = [];
      let generation: number | undefined,
        restart = false;
      do {
        const page = record(await this.bridge.invoke('requests.list', { view: 'pending', cursor }));
        if (page.restart === true) {
          restart = true;
          break;
        }
        if (
          typeof page.generation !== 'number' ||
          !Number.isSafeInteger(page.generation) ||
          (generation !== undefined && page.generation !== generation)
        )
          throw new ClientError('INVALID_RESPONSE');
        generation = page.generation;
        const decoded = decodeRows(page.requests);
        requests.push(...decoded.requests);
        faults.push(...decoded.faults);
        cursor = page.next === null ? null : text(page.next, 1000);
        await Promise.resolve();
      } while (cursor !== null);
      if (restart) continue;
      const recent = record(
        await this.bridge.invoke('requests.list', { view: 'recent', cursor: null }),
      );
      const history = decodeRows(recent.requests);
      const byId = new Map([...history.requests, ...requests].map((row) => [row.id, row]));
      return { requests: [...byId.values()], faults: [...faults, ...history.faults] };
    }
    throw new ClientError('INVALID_RESPONSE');
  }
  async get(id: string): Promise<WorkspaceRequest | null> {
    const value = record(await this.bridge.invoke('requests.get', { id })).request;
    return value === null ? null : decodeRequest(value);
  }
  async review(id: string): Promise<ManagementReview> {
    const value = record(await this.bridge.invoke('requests.review', { id }));
    if (value.kind === 'blocked') return { kind: 'blocked', reason: text(value.reason) };
    if (value.kind === 'outcome') return { kind: 'outcome' };
    if (value.kind !== 'ready') throw new ClientError('INVALID_RESPONSE');
    return {
      kind: 'ready',
      digest: text(value.digest, 128),
      legacy: value.legacy === true,
      currentContext: value.current_context === true,
      manager: value.manager == null ? null : text(value.manager, 128),
      managerIdentity: value.manager_identity == null ? null : text(value.manager_identity, 128),
    };
  }
  async decide(
    request: WorkspaceRequest,
    approve: boolean,
    confirmation?: string,
    review?: ManagementReview,
  ) {
    if (approve && review !== undefined && review.kind !== 'ready')
      throw new ClientError('INVALID_RESPONSE');
    const result = record(
      await this.bridge.invoke(approve ? 'requests.approve' : 'requests.deny', {
        id: request.id,
        fingerprint: request.fingerprint,
        ...(approve && review?.kind === 'ready' ? { review_digest: review.digest } : {}),
        ...(confirmation !== undefined ? { confirmation } : {}),
      }),
    );
    const state = text(result.state, 64);
    if (
      ![
        'pending',
        'executing',
        'completed',
        'denied',
        'failed',
        'partial',
        'uncertain',
        'expired',
        'superseded',
      ].includes(state)
    )
      throw new ClientError('INVALID_RESPONSE');
    return { state, result: result.result == null ? null : record(result.result) };
  }
  async secrets(sessionId: string) {
    return list(
      record(await this.bridge.invoke('secrets.pending', { session_id: sessionId })).requests,
      (value) => {
        const row = record(value);
        return { id: text(row.id, 128), label: text(row.label, 1000), prompt: text(row.prompt) };
      },
    );
  }
  async secret(sessionId: string, id: string, value: string) {
    const result = record(
      await this.bridge.invoke('secrets.respond', { session_id: sessionId, id, value }),
    );
    if (result.submitted !== true) throw new ClientError('INVALID_RESPONSE');
  }
  async questions(sessionId: string) {
    return list(
      record(await this.bridge.invoke('questions.pending', { session_id: sessionId })).requests,
      decodeQuestionRequest,
    );
  }
  async answer(
    sessionId: string,
    requestId: string,
    questionId: string,
    answer: string | string[] | null,
  ) {
    const result = record(
      await this.bridge.invoke('questions.respond', {
        session_id: sessionId,
        id: requestId,
        question_id: questionId,
        answer,
      }),
    );
    if (result.state !== 'expired' && result.state !== 'answered')
      throw new ClientError('INVALID_RESPONSE');
    return result.state;
  }
}
