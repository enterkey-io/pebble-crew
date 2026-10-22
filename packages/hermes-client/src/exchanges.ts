import { ClientError } from '@hermes-client/core';
import { record } from './json';
import type { SessionClient } from './session-client';
function text(value: unknown, max = 512): string {
  if (typeof value !== 'string' || !value || value.length > max)
    throw new ClientError('INVALID_RESPONSE');
  return value;
}
function time(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new ClientError('INVALID_RESPONSE');
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 500) throw new ClientError('INVALID_RESPONSE');
  return value;
}
function actor(value: unknown) {
  const a = record(value);
  return { id: text(a.id), profile: text(a.profile), name: text(a.name) };
}
function state(value: unknown) {
  if (
    value !== 'queued' &&
    value !== 'submitting' &&
    value !== 'running' &&
    value !== 'completed' &&
    value !== 'failed' &&
    value !== 'uncertain'
  )
    throw new ClientError('INVALID_RESPONSE');
  return value;
}
export function decodeExchangeReferences(value: unknown) {
  const data = record(value);
  return list(data.exchanges).map((v) => {
    const row = record(v);
    if (!Number.isSafeInteger(row.count) || Number(row.count) < 1)
      throw new ClientError('INVALID_RESPONSE');
    return {
      id: text(row.id),
      createdAt: time(row.created_at),
      count: Number(row.count),
      peer: actor(row.peer),
      toolReceipts: list(row.tool_receipts ?? []).map((value) => {
        const receipt = record(value);
        return { callId: text(receipt.call_id), timestamp: time(receipt.timestamp) };
      }),
      state: state(row.state),
    };
  });
}
export function decodeExchange(value: unknown) {
  const data = record(value);
  const participants = list(data.participants).map(actor);
  if (participants.length !== 2 || participants[0]!.id === participants[1]!.id)
    throw new ClientError('INVALID_RESPONSE');
  const messages = list(data.messages).map((v) => {
    const row = record(v);
    const author = text(row.author);
    if (!participants.some((p) => p.id === author)) throw new ClientError('INVALID_RESPONSE');
    return {
      id: text(row.id),
      author,
      text: text(row.text, 200000),
      createdAt: time(row.created_at),
    };
  });
  return { id: text(data.id), participants, messages, state: state(data.state) };
}
export type ExchangeReference = ReturnType<typeof decodeExchangeReferences>[number];
export type Exchange = ReturnType<typeof decodeExchange>;
export class ExchangeDomain {
  constructor(private readonly client: SessionClient) {}
  async references(identity: string) {
    return decodeExchangeReferences(await this.client.invoke('exchange.references', { identity }));
  }
  async read(id: string) {
    const value = decodeExchange(await this.client.invoke('exchange.read', { id }));
    if (value.id !== id) throw new ClientError('INVALID_RESPONSE');
    return value;
  }
}
