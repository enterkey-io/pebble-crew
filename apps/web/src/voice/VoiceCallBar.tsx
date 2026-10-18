import {
  AudioLines,
  Mic,
  MicOff,
  SlidersHorizontal,
  Square,
  MessageSquareText,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Item, ItemActions, ItemContent } from '../components/ui/item';
import { AudioActivity } from '../components/ai-elements/audio-activity';
import type { AudioActivityHandle } from '../components/ai-elements/audio-activity';
import type { ReactNode, RefObject } from 'react';
import { LoadingBar } from '../components/ui/loading-bar';

export function VoiceCallBar({
  state,
  muted,
  activity,
  onMute,
  onSettings,
  onEnd,
  avatar,
  transcript,
  onTranscript,
}: {
  state: 'starting' | 'live' | 'preview';
  muted: boolean;
  activity: RefObject<AudioActivityHandle | null>;
  onMute: () => void;
  onSettings: () => void;
  onEnd: () => void;
  avatar: ReactNode;
  transcript: boolean;
  onTranscript: () => void;
}) {
  return (
    <Item
      data-slot="voice-call-bar"
      aria-label={state === 'preview' ? 'Voice preview' : 'Voice call'}
      variant="muted"
      className="relative min-h-12 flex-nowrap gap-2 rounded-full py-1.5 pr-1.5 pl-3"
    >
      <span role="status" className="sr-only">
        {state === 'starting'
          ? 'Connecting voice'
          : state === 'preview'
            ? 'Playing voice preview'
            : muted
              ? 'Microphone muted'
              : 'Voice call active'}
      </span>
      <span className="flex size-9 shrink-0 items-center justify-center">
        {avatar ?? <AudioLines className="size-4" />}
      </span>
      <ItemContent className="min-w-0">
        {state === 'starting' ? (
          <LoadingBar active label="Connecting voice" />
        ) : (
          <AudioActivity ref={activity} />
        )}
      </ItemContent>
      <ItemActions className="gap-0.5">
        <Button variant="quiet" size="icon" aria-label="Voice settings" onClick={onSettings}>
          <SlidersHorizontal />
        </Button>

        <Button
          variant="quiet"
          size="icon"
          aria-label={transcript ? 'Hide voice transcript' : 'Show voice transcript'}
          aria-pressed={transcript}
          onClick={onTranscript}
        >
          <MessageSquareText />
        </Button>
        {state === 'live' && (
          <Button
            variant="quiet"
            size="icon"
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            onClick={onMute}
          >
            {muted ? <MicOff /> : <Mic />}
          </Button>
        )}
        <Button
          variant="destructive"
          size="icon"
          className="rounded-full"
          aria-label={state === 'preview' ? 'Stop preview' : 'Stop voice call'}
          onClick={onEnd}
        >
          <Square className="size-3 fill-current" />
        </Button>
      </ItemActions>
    </Item>
  );
}
