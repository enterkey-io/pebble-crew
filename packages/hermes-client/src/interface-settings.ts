import { ClientError } from '@hermes-client/core';
import { record } from './json';
import type { SessionClient } from './session-client';

export type AppearanceMode = 'light' | 'dark' | 'system';
export type ChatBubbleMode = 'pebble' | 'neutral';
export type SharedAppearance = {
  // Undefined identifies older bridges. Null means a supported preference has no saved value.
  appearance?: AppearanceMode | null;
  chatBubbles?: ChatBubbleMode | null;
};
export type InterfaceSettings = SharedAppearance & { revision: number; appTitle: string };
export type InterfaceSettingsPatch = Partial<{
  appTitle: string;
  appearance: AppearanceMode;
  chatBubbles: ChatBubbleMode;
}>;
export const defaultInterfaceSettings: InterfaceSettings = { revision: 0, appTitle: 'Pebble Crew' };

export function decodeInterfaceSettings(value: unknown): InterfaceSettings {
  const data = record(value);
  const { appearance, chat_bubbles: chatBubbles } = data;
  if (
    typeof data.revision !== 'number' ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    typeof data.app_title !== 'string' ||
    !data.app_title.trim() ||
    data.app_title.length > 64 ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(data.app_title) ||
    (appearance !== undefined &&
      appearance !== null &&
      appearance !== 'light' &&
      appearance !== 'dark' &&
      appearance !== 'system') ||
    (chatBubbles !== undefined &&
      chatBubbles !== null &&
      chatBubbles !== 'pebble' &&
      chatBubbles !== 'neutral')
  )
    throw new ClientError('INVALID_RESPONSE');
  return {
    revision: data.revision,
    appTitle: data.app_title,
    ...(appearance !== undefined && { appearance }),
    ...(chatBubbles !== undefined && { chatBubbles }),
  };
}

export class InterfaceSettingsDomain {
  constructor(private readonly bridge: Pick<SessionClient, 'invoke'>) {}
  async read() {
    return decodeInterfaceSettings(await this.bridge.invoke('presentation.settings', {}));
  }
  async update(patch: InterfaceSettingsPatch, expectedRevision: number) {
    return decodeInterfaceSettings(
      await this.bridge.invoke('presentation.settings.update', {
        ...(patch.appTitle !== undefined && { app_title: patch.appTitle }),
        ...(patch.appearance !== undefined && { appearance: patch.appearance }),
        ...(patch.chatBubbles !== undefined && { chat_bubbles: patch.chatBubbles }),
        expected_revision: expectedRevision,
      }),
    );
  }
}
