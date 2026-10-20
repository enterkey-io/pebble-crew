import { ClientError } from '@hermes-client/core';
import { record } from './json';

export const DOCUMENT_LIMIT = 256 * 1024;
export function documentFormat(name: string): 'markdown' | 'text' | undefined {
  return /\.(md|markdown)$/i.test(name) ? 'markdown' : /\.txt$/i.test(name) ? 'text' : undefined;
}
export function decodeDocument(value: unknown) {
  const data = record(value);
  if (
    typeof data.name !== 'string' ||
    !data.name ||
    data.name.length > 180 ||
    [...data.name].some(
      (char) =>
        char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    typeof data.text !== 'string' ||
    new TextEncoder().encode(data.text).length > DOCUMENT_LIMIT ||
    [...data.text].some((char) => char.charCodeAt(0) < 32 && !'\n\r\t'.includes(char)) ||
    !documentFormat(data.name) ||
    data.format !== documentFormat(data.name)
  )
    throw new ClientError('INVALID_RESPONSE');
  return { name: data.name, text: data.text, format: documentFormat(data.name)! };
}
export type SharedDocument = ReturnType<typeof decodeDocument>;

export function decodeDocumentRequest(value: unknown, now = Date.now()) {
  const data = record(value);
  const document = decodeDocument(data);
  if (
    typeof data.request_id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(data.request_id) ||
    typeof data.expires_at !== 'number' ||
    !Number.isSafeInteger(data.expires_at) ||
    data.expires_at <= now ||
    data.expires_at > now + 65_000
  )
    throw new ClientError('INVALID_RESPONSE');
  return { ...document, requestId: data.request_id };
}
