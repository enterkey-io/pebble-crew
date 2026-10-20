import { Button } from '../components/ui/button';
import { Icon } from './Icon';
import { useRef } from 'react';
import { AudioLines, Square } from 'lucide-react';

export function ComposerAction({
  mode,
  disabled,
  onStop,
  onVoice,
  separateStop = false,
  stopDisabled = false,
  stopping = false,
}: {
  mode: 'voice' | 'send' | 'stop' | 'stopping';
  disabled: boolean;
  onStop: () => void;
  onVoice: () => void;
  separateStop?: boolean;
  stopDisabled?: boolean;
  stopping?: boolean;
}) {
  const sending = mode === 'send';
  const action = mode === 'voice' ? 'voice' : sending ? 'send' : 'stop';
  const pressed = useRef<typeof action | null>(null);
  return (
    <>
      {separateStop && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="self-end size-9 shrink-0 rounded-full p-0 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
          aria-label={stopping ? 'Stopping' : 'Stop'}
          disabled={stopDisabled}
          onClick={onStop}
        >
          <Square className="size-4" fill="currentColor" />
        </Button>
      )}
      <Button
        type={sending ? 'submit' : 'button'}
        variant="secondary"
        size="icon"
        className={`self-end size-9 shrink-0 rounded-full bg-foreground p-0 text-background hover:bg-foreground/90 pointer-coarse:size-11 ${action}-button`}
        data-action={action}
        aria-label={
          mode === 'voice'
            ? 'Voice chat'
            : sending
              ? 'Send message'
              : mode === 'stopping'
                ? 'Stopping'
                : 'Stop'
        }
        disabled={disabled}
        onPointerDown={() => (pressed.current = action)}
        onPointerCancel={() => (pressed.current = null)}
        onBlur={() => (pressed.current = null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            if (event.repeat) {
              event.preventDefault();
              return;
            }
            pressed.current = action;
          }
        }}
        onClick={(event) => {
          const origin = pressed.current;
          pressed.current = null;
          if (origin && origin !== action) {
            event.preventDefault();
            return;
          }
          if (mode === 'voice') onVoice();
          else if (!sending) onStop();
        }}
      >
        <span className="pc-action-glyphs" aria-hidden="true">
          <span data-glyph="voice">
            <AudioLines />
          </span>
          <span data-glyph="send">
            <Icon name="send" />
          </span>
          <span data-glyph="stop">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          </span>
        </span>
      </Button>
    </>
  );
}
