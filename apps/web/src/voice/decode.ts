export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid voice response');
  return Object.fromEntries(Object.entries(value));
}
export const voiceSpeeds = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type VoiceSpeed = (typeof voiceSpeeds)[number];
export function voiceSpeed(value: unknown): VoiceSpeed {
  const speed = voiceSpeeds.find((item) => item === value);
  if (speed === undefined) throw new Error('Invalid voice speed');
  return speed;
}
export type VoiceSettings =
  | { supported: false }
  | {
      supported: true;
      configured: boolean;
      keyConfirmed: boolean;
      canChangeKey: boolean;
      voice: string;
      voices: string[];
      speed: VoiceSpeed;
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
    typeof data.setup_complete !== 'boolean' ||
    data.speed_control !== 'instruction'
  )
    throw new Error('Invalid voice settings');
  return {
    supported: true,
    configured: data.configured,
    keyConfirmed: data.configured && (data.key_confirmed === true || data.setup_complete === true),
    canChangeKey: data.can_change_key !== false,
    voice: data.voice,
    voices: data.voices,
    speed: voiceSpeed(data.speed),
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
