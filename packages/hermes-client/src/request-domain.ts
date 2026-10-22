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
  async decide(request: WorkspaceRequest, approve: boolean, confirmation?: string) {
    const result = record(
      await this.bridge.invoke(approve ? 'requests.approve' : 'requests.deny', {
        id: request.id,
        fingerprint: request.fingerprint,
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
