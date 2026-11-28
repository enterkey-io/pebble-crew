export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid voice response');
  return Object.fromEntries(Object.entries(value));
}
export type VoiceProvider = 'openai' | 'elevenlabs';
export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === 'openai' || value === 'elevenlabs';
}
export function voiceLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([id, label]) =>
        /^[A-Za-z0-9_-]{1,80}$/.test(id) &&
        typeof label === 'string' &&
        label.length > 0 &&
        label.length <= 100,
    ),
  );
}
export type VoiceSettings =
  | { supported: false }
  | {
      supported: true;
      configured: boolean;
      keyConfirmed: boolean;
      canChangeKey: boolean;
      provider: VoiceProvider;
      providers: VoiceProvider[];
      voice: string;
      labels: Record<string, string>;
      voices: string[];
      setupComplete: boolean;
    };
export function settings(value: unknown): VoiceSettings {
  const data = record(value);
  if (data.supported === false) return { supported: false };
  if (
    data.supported !== true ||
    typeof data.configured !== 'boolean' ||
    typeof data.voice !== 'string' ||
    !Array.isArray(data.voices) ||
    !data.voices.every((v): v is string => typeof v === 'string' && v.length < 80) ||
    typeof data.setup_complete !== 'boolean'
  )
    throw new Error('Invalid voice settings');
  return {
    supported: true,
    configured: data.configured,
    keyConfirmed: data.configured && (data.key_confirmed === true || data.setup_complete === true),
    canChangeKey: data.can_change_key !== false,
    provider: isVoiceProvider(data.provider) ? data.provider : 'openai',
    providers: Array.isArray(data.providers) ? data.providers.filter(isVoiceProvider) : ['openai'],
    voice: data.voice,
    labels: voiceLabels(data.voice_labels),
    voices: data.voices,
    setupComplete: data.setup_complete,
  };
}
export type VoiceSettingsRequest =
  | { kind: 'settings' }
  | { kind: 'start' }
  | { kind: 'replace-key' }
  | { kind: 'key-failure'; message: string }
  | { kind: 'failure'; message: string };
export function sessionAnswer(value: unknown) {
  const data = record(value),
    session = record(data.session),
    transport = record(data.transport);
  if (
    typeof session.id !== 'string' ||
    transport.type !== 'webrtc' ||
    typeof transport.sdp !== 'string'
  )
    throw new Error('Invalid voice answer');
  return { session: { id: session.id }, transport: { sdp: transport.sdp } };
}
