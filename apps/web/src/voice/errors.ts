import { ClientError } from '@hermes-client/core';

export class VoiceStartError extends Error {
  constructor(
    readonly stage: 'microphone' | 'transport' | 'provider',
    readonly reason: unknown,
  ) {
    super('Voice connection failed');
  }
}
export function rejectedVoiceKey(cause: unknown): boolean {
  const reason = cause instanceof VoiceStartError ? cause.reason : cause;
  return (
    reason instanceof ClientError &&
    (reason.code === 'VOICE_KEY_REJECTED' || reason.code === 'VOICE_KEY_REQUIRED')
  );
}

export function voiceFailure(cause: unknown, preview = false): string {
  const reason = cause instanceof VoiceStartError ? cause.reason : cause;
  if (reason instanceof ClientError) return reason.message;
  if (cause instanceof VoiceStartError && cause.stage === 'microphone') {
    if (reason instanceof DOMException && reason.name === 'NotFoundError')
      return 'No microphone was found. Connect one, then try again.';
    if (reason instanceof DOMException && reason.name === 'NotReadableError')
      return 'Your microphone is in use or unavailable. Close other audio apps, then try again.';
    return 'Microphone access is blocked. Allow it in your browser’s site settings, then try again.';
  }
  return preview
    ? 'The voice preview could not connect. Try again. Preview does not use your microphone.'
    : 'The voice connection could not start. Try again; your text chat is still available.';
}
