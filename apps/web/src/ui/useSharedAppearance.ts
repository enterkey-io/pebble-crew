import { useEffect } from 'react';
import { InterfaceSettingsDomain } from '@hermes-client/protocol';
import type {
  InterfaceSettings,
  InterfaceSettingsPatch,
  SessionClient,
} from '@hermes-client/protocol';
import { useAppearance } from './AppearanceProvider';
import { localAppearanceChoices } from './appearance-bootstrap';

export function useSharedAppearance(
  client: SessionClient | undefined,
  { appearance, chatBubbles, revision }: InterfaceSettings,
  accept: (settings: InterfaceSettings) => void,
) {
  const { mode, chatBubbles: displayedBubbles, setMode, setChatBubbles } = useAppearance();
  useEffect(() => {
    if (appearance && appearance !== mode) setMode(appearance);
    if (chatBubbles && chatBubbles !== displayedBubbles) setChatBubbles(chatBubbles);
  }, [appearance, chatBubbles, displayedBubbles, mode, setMode, setChatBubbles]);

  useEffect(() => {
    if (!client || (appearance !== null && chatBubbles !== null)) return;
    const local = localAppearanceChoices();
    const patch: InterfaceSettingsPatch = {
      ...(appearance === null && local.appearance && { appearance: local.appearance }),
      ...(chatBubbles === null && local.chatBubbles && { chatBubbles: local.chatBubbles }),
    };
    if (!patch.appearance && !patch.chatBubbles) return;

    let current = true;
    // A fresh browser has no explicit choice to import. A concurrent owner
    // change wins the revision check and will arrive through roster refresh.
    void new InterfaceSettingsDomain(client).update(patch, revision).then(
      (settings) => {
        if (current) accept(settings);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, appearance, chatBubbles, revision, accept]);
}
