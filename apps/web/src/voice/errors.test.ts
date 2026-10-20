import { describe, expect, it } from 'vitest';
import { ClientError } from '@hermes-client/core';
import { settings } from './decode';
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
  it('decodes voice and owner-saved setup without guessing readiness', () => {
    const value = {
      supported: true,
      configured: true,
      voice: 'marin',
      voices: ['marin'],
      setup_complete: false,
    };
    expect(settings(value)).toMatchObject({ voice: 'marin', setupComplete: false });
    expect(settings({ ...value, speed: 1.25 })).not.toHaveProperty('speed');
    expect(() => settings({ ...value, setup_complete: undefined })).toThrow();
  });
});
