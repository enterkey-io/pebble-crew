import { Phone } from 'lucide-react';
import type { VoiceCallRecord } from '@hermes-client/protocol';
import { TraceDescription, TraceIcon, TraceLine, TraceTitle } from '../components/ui/trace';

export function VoiceCallEntry({ call }: { call: VoiceCallRecord }) {
  const ended = new Date(call.endedAt);
  return (
    <TraceLine>
      <TraceIcon>
        <Phone />
      </TraceIcon>
      {/* Video calls are discontinued; saved ones read as plain calls. */}
      <TraceTitle>{call.kind === 'video' ? 'Call ended' : 'Voice call ended'}</TraceTitle>
      <TraceDescription>
        <time dateTime={ended.toISOString()} title={ended.toLocaleString()}>
          {ended.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </time>
      </TraceDescription>
    </TraceLine>
  );
}
