import { describe, expect, it } from 'vitest';
import { voiceGroups } from './voice-groups';

describe('available voice groups', () => {
  it('groups documented presentations and retains unclassified voices', () => {
    expect(
      voiceGroups(['marin', 'willow', 'ripple', 'quartz', 'cedar', 'willow', 'custom-owner-voice']),
    ).toEqual([
      { label: 'Female', voices: ['willow', 'quartz'] },
      { label: 'Male', voices: ['ripple'] },
      { label: 'Other', voices: ['marin', 'cedar', 'custom-owner-voice'] },
    ]);
  });
  it('omits empty groups and does not invent provider availability', () => {
    expect(voiceGroups(['gleam'])).toEqual([{ label: 'Female', voices: ['gleam'] }]);
    expect(voiceGroups([])).toEqual([]);
  });
});
