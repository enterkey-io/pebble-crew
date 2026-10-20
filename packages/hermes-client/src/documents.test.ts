import { describe, it, expect } from 'vitest';
import { decodeDocument, decodeDocumentRequest, documentFormat, DOCUMENT_LIMIT } from './documents';
const file = { name: 'plan.md', text: '# Plan\n\nHello', format: 'markdown' };
describe('document sharing boundary', () => {
  it('accepts only bounded UTF-8 document metadata and text', () => {
    expect(decodeDocument(file)).toEqual(file);
    expect(documentFormat('NOTES.TXT')).toBe('text');
    expect(documentFormat('image.svg')).toBeUndefined();
    for (const invalid of [
      { ...file, name: '../plan.md' },
      { ...file, name: 'plan.html' },
      { ...file, format: 'text' },
      { ...file, text: '\0' },
      { ...file, text: 'x'.repeat(DOCUMENT_LIMIT + 1) },
    ])
      expect(() => decodeDocument(invalid)).toThrow();
  });
  it('ignores expired, malformed and unbounded future open requests', () => {
    const request = {
      ...file,
      request_id: '12345678-1234-1234-1234-123456789abc',
      expires_at: 2000,
    };
    expect(decodeDocumentRequest(request, 1000).requestId).toBe(request.request_id);
    for (const invalid of [
      { ...request, expires_at: 999 },
      { ...request, expires_at: 100000 },
      { ...request, request_id: 'any' },
    ])
      expect(() => decodeDocumentRequest(invalid, 1000)).toThrow();
  });
});
