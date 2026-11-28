import { expect, it, vi } from 'vitest';
import { decodeInterfaceSettings, InterfaceSettingsDomain } from './interface-settings';

it('decodes bounded titles and rejects malformed revisions or control characters', () => {
  expect(decodeInterfaceSettings({ revision: 2, app_title: 'Öykü’s Team' })).toEqual({
    revision: 2,
    appTitle: 'Öykü’s Team',
  });
  for (const value of [
    { revision: true, app_title: 'Team' },
    { revision: -1, app_title: 'Team' },
    { revision: 0, app_title: '' },
    { revision: 0, app_title: 'x'.repeat(65) },
    { revision: 0, app_title: 'Hide\u202e' },
  ])
    expect(() => decodeInterfaceSettings(value)).toThrow();
});
it('uses the shared settings boundary without editing agent profiles', async () => {
  const invoke = vi.fn().mockResolvedValue({ revision: 1, app_title: 'My Team' });
  const domain = new InterfaceSettingsDomain({ invoke });
  expect(await domain.update({ appTitle: 'My Team' }, 0)).toEqual({
    revision: 1,
    appTitle: 'My Team',
  });
  expect(invoke).toHaveBeenLastCalledWith('presentation.settings.update', {
    app_title: 'My Team',
    expected_revision: 0,
  });
  await domain.read();
  expect(invoke).toHaveBeenLastCalledWith('presentation.settings', {});
});

it('distinguishes unconfigured preferences from legacy bridges and rejects invalid values', () => {
  const base = { revision: 2, app_title: 'Team' };
  expect(decodeInterfaceSettings({ ...base, appearance: null, chat_bubbles: 'neutral' })).toEqual({
    revision: 2,
    appTitle: 'Team',
    appearance: null,
    chatBubbles: 'neutral',
  });
  expect(() => decodeInterfaceSettings({ ...base, appearance: 'sepia' })).toThrow();
  expect(() => decodeInterfaceSettings({ ...base, chat_bubbles: true })).toThrow();
});
