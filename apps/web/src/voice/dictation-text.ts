/** One recognition result as the browser reports it. */
export type HeardResult = { transcript: string; final: boolean };

/** What was already sent from the current recognition session. */
export type SentMark = { text: string; count: number };

export const nothingSent: SentMark = { text: '', count: 0 };

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Everything recognized in this session, in order. */
export function heardText(results: HeardResult[]) {
  return tidy(results.map((result) => result.transcript).join(' '));
}

/** The words heard since the last send. Safari sometimes keeps growing one
 *  result instead of starting a new one, so text that extends what was sent
 *  is trimmed by prefix; otherwise only results after the send count. */
export function pendingText(results: HeardResult[], sent: SentMark) {
  const all = heardText(results);
  if (!sent.text) return all;
  // Punctuation added to sent words afterwards is not a new sentence.
  if (all.startsWith(sent.text))
    return tidy(all.slice(sent.text.length).replace(/^[\s.,!?;:]+/, ''));
  return heardText(results.slice(sent.count));
}

/** Marks everything heard so far as sent. */
export function markSent(results: HeardResult[]): SentMark {
  return { text: heardText(results), count: results.length };
}
