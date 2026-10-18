import { useId } from 'react';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '../components/ui/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../components/ui/select';
import { Slider } from '../components/ui/slider';
import { voiceSpeed, voiceSpeeds } from './decode';
import type { VoiceSettings, VoiceSpeed } from './decode';

export type VoiceChoices = { voice: string; speed: VoiceSpeed };
export function VoiceOptions({
  value,
  voices,
  disabled = false,
  onChange,
}: {
  value: VoiceChoices;
  voices: string[];
  disabled?: boolean;
  onChange: (value: VoiceChoices) => void;
}) {
  const id = useId();
  return (
    <FieldGroup className="gap-5">
      <Field>
        <FieldLabel htmlFor={`${id}-voice`}>Voice</FieldLabel>
        <Select
          value={value.voice}
          disabled={disabled}
          onValueChange={(voice) => onChange({ ...value, voice })}
        >
          <SelectTrigger id={`${id}-voice`} className="w-full" aria-label="Voice">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([value.voice, ...voices])].map((voice) => (
              <SelectItem key={voice} value={voice}>
                {voice[0]?.toUpperCase()}
                {voice.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor={`${id}-speed`}>Speed</FieldLabel>
          <output className="text-sm tabular-nums" aria-live="off">
            {value.speed}×
          </output>
        </div>
        <Slider
          id={`${id}-speed`}
          aria-label="Speed"
          value={[value.speed]}
          min={0.75}
          max={2}
          step={0.25}
          disabled={disabled}
          onValueChange={(values) => onChange({ ...value, speed: voiceSpeed(values[0]) })}
          aria-valuetext={`${value.speed} times`}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground" aria-hidden="true">
          {voiceSpeeds.map((speed) => (
            <span key={speed}>{speed}×</span>
          ))}
        </div>
        <FieldDescription className="text-xs">
          Requested speaking speed; exact timing varies.
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}
export function choices(settings: Extract<VoiceSettings, { supported: true }>): VoiceChoices {
  return { voice: settings.voice, speed: settings.speed };
}
