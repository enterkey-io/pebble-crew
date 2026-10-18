export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid voice response');
  return Object.fromEntries(Object.entries(value));
}
export type VoiceSettings =
  | { supported: false }
  | {
      supported: true;
      configured: boolean;
      canChangeKey: boolean;
      voice: string;
      voices: string[];
      pace: 'slower' | 'natural' | 'faster';
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
    !['slower', 'natural', 'faster'].includes(String(data.pace))
  )
    throw new Error('Invalid voice settings');
  return {
    supported: true,
    configured: data.configured,
    canChangeKey: data.can_change_key !== false,
    voice: data.voice,
    voices: data.voices,
    pace: data.pace === 'slower' ? 'slower' : data.pace === 'faster' ? 'faster' : 'natural',
  };
}
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
