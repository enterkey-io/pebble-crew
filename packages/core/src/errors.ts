export const voiceErrors = {
  ELEVEN_KEY_REQUIRED: 'Add an ElevenLabs API key to use voice.',
  ELEVEN_KEY_REJECTED: 'ElevenLabs rejected this saved key.',
  ELEVEN_ACCESS_DENIED: 'This ElevenLabs key does not have the required voice access.',
  ELEVEN_RATE_LIMITED: 'ElevenLabs limited this request. Wait a moment, then try again.',
  ELEVEN_SAMPLE_UNAVAILABLE: 'ElevenLabs has no playable sample for this voice. Try another voice.',
  ELEVEN_CONNECTION_FAILED: 'Hermes could not open a connection to ElevenLabs voice.',
  VOICE_KEY_REQUIRED: 'Add an OpenAI API key to use voice.',
  VOICE_KEY_REJECTED: 'OpenAI rejected this saved key.',
  VOICE_ACCESS_DENIED:
    'This OpenAI project does not have live voice access. Check its model permissions.',
  VOICE_MODEL_UNAVAILABLE:
    'The configured live voice model or endpoint is unavailable. Check voice settings in Hermes.',
  VOICE_LIMIT_REACHED:
    'OpenAI limited this request. Try again later, or check your project’s limits if it continues.',
  VOICE_RATE_LIMITED: 'OpenAI is rate limiting voice requests. Wait a moment before trying again.',
  VOICE_CREDITS_EXHAUSTED:
    'Your OpenAI organization has no prepaid credits remaining. Add credits to use voice.',
  VOICE_SPEND_LIMIT_REACHED:
    'Your OpenAI project or organization reached its spending limit. Update that limit to use voice.',
  VOICE_QUOTA_EXHAUSTED:
    'Your OpenAI project or organization has no available API quota. Check its usage limits and billing.',
  VOICE_PROVIDER_UNAVAILABLE: 'OpenAI live voice is temporarily unavailable. Try again shortly.',
  VOICE_OFFER_REJECTED:
    'OpenAI rejected the voice connection request. Check the configured model and endpoint in Hermes.',
  VOICE_PROVIDER_TIMEOUT: 'OpenAI did not answer the voice connection request in time. Try again.',
  VOICE_PROVIDER_UNREACHABLE:
    'Your Hermes server could not reach OpenAI. Check its network connection.',
  VOICE_INVALID_ANSWER: 'The voice provider returned an invalid connection response.',
  VOICE_SETUP_FAILED:
    'Hermes could not confirm voice setup. Check this Pebble’s voice configuration.',
  VOICE_PREFERENCES_FAILED: 'Hermes could not save your voice settings.',
} as const;

export const atmeeErrors = {
  ATMEE_KEY_REJECTED: 'Atmee rejected this API key.',
  ATMEE_KEY_SCOPE: 'Enable avatar read access for this key in Atmee Studio.',
  ATMEE_KEY_SAVE_FAILED: 'Hermes couldn’t save this Atmee key. Try again.',
  ATMEE_UNAVAILABLE: 'Atmee is unavailable. Try again shortly.',
  ATMEE_AVATAR_UNAVAILABLE: 'Select an available video avatar in this Pebble’s Voice settings.',
  ATMEE_CALL_LIMIT: 'Check your Atmee credits or end the other video call.',
  ATMEE_VOICE_UNAVAILABLE:
    'This Atmee voice sample is unavailable. Choose another voice or design a new one.',
  ATMEE_VOICE_PREVIEW_MISSING:
    'Pebble Crew did not save the playback link. You can still select this voice for your avatar.',
  ATMEE_BUILD_SCOPE: 'Use an account-wide Atmee key with avatar and generation write access.',
  ATMEE_BUILD_CREDITS:
    'This Atmee account has no V2-eligible credits. Check your plan or invite in Atmee Studio.',
  ATMEE_BUILD_INPUT: 'Atmee could not use these inputs. Try another photo or voice style.',
} as const;

export type ErrorCode =
  | keyof typeof voiceErrors
  | keyof typeof atmeeErrors
  | 'CONVERSATION_CHANGED'
  | 'BOT_CHAT_MISSING'
  | 'LEASE_GONE'
  | 'STREAM_ACTIVE'
  | 'NATIVE_UNAVAILABLE'
  | 'CAPACITY'
  | 'UNSUPPORTED_COMMAND'
  | 'STALE_REVISION'
  | 'HANDLE_TAKEN'
  | 'INVALID_REPORTING'
  | 'UPDATE_REQUIRED'
  | 'MODEL_UNAVAILABLE'
  | 'REQUIRES_SETUP'
  | 'INVALID_ATTACHMENT'
  | 'ATTACHMENT_QUOTA'
  | 'INVALID_PHOTO'
  | 'INVALID_PARAMETERS'
  | 'INVALID_ENDPOINT'
  | 'INVALID_CREDENTIAL'
  | 'DISCONNECTED'
  | 'REQUEST_FAILED'
  | 'UNAUTHORIZED'
  | 'REQUEST_TIMEOUT'
  | 'RESPONSE_TOO_LARGE'
  | 'INVALID_RESPONSE'
  | 'UNSUPPORTED'
  | 'RPC_FAILED';

const messages: Record<ErrorCode, string> = {
  CONVERSATION_CHANGED: 'This conversation needs to be reopened.',
  BOT_CHAT_MISSING: 'This Hermes profile has no active Bot Chat.',
  LEASE_GONE: 'The connection needs to be restored.',
  STREAM_ACTIVE: 'Live updates are already connected.',
  NATIVE_UNAVAILABLE: 'Hermes is temporarily unavailable.',
  CAPACITY: 'Too many open connections. Close an unused tab and try again.',
  UPDATE_REQUIRED: 'Update Pebble Crew and its Hermes plugin, then reopen the app.',
  ...voiceErrors,
  ...atmeeErrors,
  UNSUPPORTED_COMMAND:
    'This command is not supported in Pebble Crew. Use a command from the suggestions or run it in Hermes.',
  STALE_REVISION: 'Your workspace changed. Refresh it before saving again.',
  HANDLE_TAKEN: 'That handle already belongs to another agent. Choose a different handle.',
  INVALID_REPORTING:
    'Every pebble must report to the Main Pebble without a cycle. Move crew members before removing their crew.',
  MODEL_UNAVAILABLE:
    'The selected model authorization changed or needs setup in Hermes. Review it before creating this agent.',
  REQUIRES_SETUP: 'This service needs its native Hermes installation before it can be added here.',
  INVALID_ATTACHMENT: 'Choose a valid file up to 10 MB. Images must be PNG, JPEG or WebP.',
  ATTACHMENT_QUOTA: 'Attachment storage is full on your Hermes host.',
  INVALID_PHOTO: 'That photo could not be safely opened. Choose a PNG, JPEG or WebP image.',
  INVALID_PARAMETERS:
    'These settings could not be saved. Check the fields and refresh before trying again.',
  INVALID_ENDPOINT:
    'Enter a trusted HTTPS endpoint without credentials, query parameters, or fragments.',
  INVALID_CREDENTIAL: 'A credential is required for this interface.',
  DISCONNECTED: 'This connection has been closed.',
  REQUEST_FAILED:
    'The request failed. Check network access, origin permissions, and server configuration.',
  UNAUTHORIZED: 'The server did not authorize this request.',
  REQUEST_TIMEOUT: 'The server did not respond in time.',
  RESPONSE_TOO_LARGE: 'The response exceeded the permitted size.',
  INVALID_RESPONSE: 'The server returned an unexpected response.',
  UNSUPPORTED: 'The required Hermes interface is not available through this connection.',
  RPC_FAILED: 'Hermes could not complete the requested operation.',
};

/** Remote messages, URLs and credentials never enter public errors. */
export class ClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly evidence?: { status: number; retryAfterMs: number },
    readonly delivery: 'unknown' | 'not-dispatched' = 'unknown',
  ) {
    super(messages[code]);
    this.name = 'ClientError';
  }
}

export function safeError(error: unknown): ClientError {
  return error instanceof ClientError ? error : new ClientError('REQUEST_FAILED');
}
