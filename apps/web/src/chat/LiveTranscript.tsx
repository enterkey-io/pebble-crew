import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { MediaGalleryProvider } from './media-gallery-context';
import type { ComponentProps } from 'react';
import type { SharedConversationFile } from '@hermes-client/protocol';
import { withSharedFiles } from '../conversation';
import { Transcript } from './Transcript';
import type { LiveText } from './live-text';
import type { SendProjection } from './send-projection';
import { cardsWithinHistory } from './presentation';

type Props = Omit<ComponentProps<typeof Transcript>, 'liveIds'> & {
  text: LiveText;
  projection: SendProjection;
  files: SharedConversationFile[];
  onTextLayout: () => void;
  hasEarlier?: boolean;
};

/** Native history and live text meet here; token updates stay below the shell. */
export function LiveTranscript({
  text,
  projection,
  files,
  messages,
  onTextLayout,
  hasEarlier = false,
  cards = [],
  ...props
}: Props) {
  const stream = useSyncExternalStore(text.subscribe, text.get);
  const decorated = useMemo(() => withSharedFiles(messages, files), [messages, files]);
  const historyCards = useMemo(
    () => cardsWithinHistory(messages, cards, hasEarlier),
    [messages, cards, hasEarlier],
  );
  const displayed = projection.display(decorated, stream);
  useLayoutEffect(onTextLayout, [stream, onTextLayout]);
  return (
    <MediaGalleryProvider>
      <Transcript
        {...props}
        cards={historyCards}
        messages={displayed.messages}
        liveIds={displayed.liveIds}
      />
    </MediaGalleryProvider>
  );
}
