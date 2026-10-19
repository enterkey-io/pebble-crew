import { describe, expect, it } from 'vitest';
import { ClientError } from '@hermes-client/core';
import { settings, voiceSpeed } from './decode';
import { voiceFailure, VoiceStartError } from './errors';

describe('voice boundaries', () => {
  it('distinguishes output-only provider failure from microphone permission', () => {
    expect(
      voiceFailure(new VoiceStartError('provider', new ClientError('VOICE_KEY_REJECTED')), true),
    ).toContain('rejected this saved key');
    expect(
      voiceFailure(new VoiceStartError('provider', new Error('PRIVATE VENDOR BODY')), true),
    ).not.toContain('PRIVATE');
    expect(
      voiceFailure(
        new VoiceStartError('microphone', new DOMException('Denied', 'NotAllowedError')),
      ),
    ).toContain('Microphone access is blocked');
    expect(
      voiceFailure(new VoiceStartError('microphone', new DOMException('Missing', 'NotFoundError'))),
    ).toContain('No microphone');
  });
  it('decodes numeric speed and owner-saved setup without guessing readiness', () => {
    const value = {
      supported: true,
      configured: true,
      voice: 'marin',
      voices: ['marin'],
      speed: 1.25,
      speed_control: 'instruction',
      setup_complete: false,
    };
    expect(settings(value)).toMatchObject({ speed: 1.25, setupComplete: false });
    expect(() => settings({ ...value, speed: 100 })).toThrow();
    expect(() => settings({ ...value, setup_complete: undefined })).toThrow();
    expect(() => voiceSpeed('1')).toThrow();
  });
});
