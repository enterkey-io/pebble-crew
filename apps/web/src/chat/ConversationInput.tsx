import { useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { SessionClient, WorkspaceBot } from '@hermes-client/protocol';
import { PromptInputFrame, PromptInputField } from '../components/ai-elements/prompt-input';
import { CommandSuggestions } from './CommandSuggestions';
import type { CommandSuggestionsHandle } from './CommandSuggestions';
import { MentionSuggestions, useMentionSuggestions } from './MentionSuggestions';
import { ComposerAction } from './ComposerAction';
import { useComposerSize } from './use-composer-size';
import type { useUploads } from './uploads';

/** The input owns keystroke renders; navigation and send receipts can still restore its draft. */
export class ComposerDraft {
  #value = '';
  #listeners = new Set<() => void>();
  get = () => this.#value;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  set(value: string) {
    if (value === this.#value) return;
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }
}

export function ConversationInput({
  draft,
  field,
  client,
  conversation,
  active,
  target,
  title,
  busy,
  blocked,
  switching,
  running,
  stopping,
  uploads,
  voice,
  onEdit,
  onSend,
  onStop,
  onVoice,
  children,
}: {
  draft: ComposerDraft;
  field: RefObject<HTMLTextAreaElement | null>;
  client: SessionClient;
  conversation: string;
  active: boolean;
  target: { kind: 'bot'; sessionId: string } | { kind: 'room'; bots: WorkspaceBot[] } | undefined;
  title: string;
  busy: boolean;
  blocked: boolean;
  switching: boolean;
  running: boolean;
  stopping: boolean;
  uploads: ReturnType<typeof useUploads>;
  voice: boolean;
  onEdit: (value: string) => void;
  onSend: (command?: string) => void;
  onStop: () => void;
  onVoice: () => void;
  children: ReactNode;
}) {
  const value = useSyncExternalStore(draft.subscribe, draft.get);
  const [caret, setCaret] = useState(0);
  const commands = useRef<CommandSuggestionsHandle>(null);
  function edit(text: string) {
    draft.set(text);
    onEdit(text);
  }
  const mentions = useMentionSuggestions({
    value,
    caret,
    input: field,
    bots: target?.kind === 'room' ? target.bots : [],
    onChoose(text, position) {
      edit(text);
      setCaret(position);
    },
  });
  useComposerSize(field, value, conversation, active);
  const hasMessage = !!value.trim() || uploads.files.length > 0;
  const voiceAction = !running && !hasMessage && target?.kind === 'bot' && voice;
  return (
    <>
      {target?.kind === 'bot' && (
        <CommandSuggestions
          ref={commands}
          client={client}
          enabled={!blocked && !busy}
          sessionId={target.sessionId}
          text={value}
          onChoose={(text, execute) => {
            edit(text);
            field.current?.focus();
            if (execute) onSend(text);
          }}
        />
      )}
      <MentionSuggestions suggestions={mentions} className="pc-composer-width mb-2" />
      <PromptInputFrame
        className="pc-composer pc-composer-row pc-composer-width"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) field.current?.focus();
        }}
      >
        {children}
        <PromptInputField
          sizing="fixed"
          ref={field}
          rows={1}
          aria-label="Message"
          placeholder={target ? `Message ${title}` : 'Choose a conversation'}
          value={value}
          {...mentions.inputProps}
          disabled={!target}
          readOnly={switching}
          maxLength={16000}
          onPaste={(e) => {
            if (
              !blocked &&
              !busy &&
              client.supportsAttachments &&
              target?.kind === 'bot' &&
              e.clipboardData.files.length
            ) {
              e.preventDefault();
              uploads.add([...e.clipboardData.files]);
            }
          }}
          onChange={(e) => {
            edit(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (
              !e.nativeEvent.isComposing &&
              (mentions.key(e.key) || commands.current?.key(e.key))
            ) {
              e.preventDefault();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <ComposerAction
          mode={
            running && !hasMessage
              ? stopping
                ? 'stopping'
                : 'stop'
              : voiceAction
                ? 'voice'
                : 'send'
          }
          disabled={
            running && !hasMessage
              ? stopping || blocked
              : !target || (!voiceAction && !hasMessage) || !uploads.ready || busy || blocked
          }
          onStop={onStop}
          onVoice={onVoice}
          separateStop={running && hasMessage}
          stopDisabled={stopping || blocked}
          stopping={stopping}
        />
      </PromptInputFrame>
    </>
  );
}
