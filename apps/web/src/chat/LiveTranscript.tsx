import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import type { ComponentProps } from 'react';
import type { SharedConversationFile } from '@hermes-client/protocol';
import { withSharedFiles } from '../conversation';
import { Transcript } from './Transcript';
import type { LiveText } from './live-text';
import type { SendProjection } from './send-projection';

type Props = Omit<ComponentProps<typeof Transcript>, 'liveIds'> & {
  text: LiveText;
  projection: SendProjection;
  files: SharedConversationFile[];
  onTextLayout: () => void;
};

/** Native history and live text meet here; token updates stay below the shell. */
export function LiveTranscript({
  text,
  projection,
  files,
  messages,
  onTextLayout,
  ...props
}: Props) {
  const stream = useSyncExternalStore(text.subscribe, text.get);
  const decorated = useMemo(() => withSharedFiles(messages, files), [messages, files]);
  const displayed = projection.display(decorated, stream);
  useLayoutEffect(onTextLayout, [stream, onTextLayout]);
  return <Transcript {...props} messages={displayed.messages} liveIds={displayed.liveIds} />;
}
