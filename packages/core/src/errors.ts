export const voiceErrors = {
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

export type ErrorCode =
  | keyof typeof voiceErrors
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
  UPDATE_REQUIRED: 'Refresh Pebble Crew before editing reporting relationships.',
  ...voiceErrors,
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
  constructor(readonly code: ErrorCode) {
    super(messages[code]);
    this.name = 'ClientError';
  }
}

export function safeError(error: unknown): ClientError {
  return error instanceof ClientError ? error : new ClientError('REQUEST_FAILED');
}
