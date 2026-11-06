import { useId, useRef, useState } from 'react';
import { Field, FieldLabel } from '../components/ui/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from '../components/ui/select';
import type { VoiceProvider, VoiceSettings } from './decode';
import { voiceGroups } from './voice-groups';

export type VoiceChoices = { voice: string };
export function VoiceOptions({
  value,
  voices,
  provider,
  labels,
  disabled = false,
  onChange,
}: {
  value: VoiceChoices;
  voices: string[];
  provider: VoiceProvider;
  labels: Record<string, string>;
  disabled?: boolean;
  onChange: (value: VoiceChoices) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [boundary, setBoundary] = useState<Element | null>(null);
  return (
    <Field>
      <FieldLabel htmlFor={`${id}-voice`}>Voice</FieldLabel>
      <Select
        value={value.voice}
        disabled={disabled}
        onOpenChange={(open) => {
          if (open) setBoundary(trigger.current?.closest('[data-slot="dialog-content"]') ?? null);
        }}
        onValueChange={(voice) => onChange({ ...value, voice })}
      >
        <SelectTrigger ref={trigger} id={`${id}-voice`} className="w-full" aria-label="Voice">
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="start"
          collisionBoundary={boundary ?? undefined}
          collisionPadding={8}
          className="max-h-[min(16rem,var(--radix-select-content-available-height))] overscroll-contain"
        >
          {provider === 'elevenlabs'
            ? [...new Set([value.voice, ...voices])].map((voice) => (
                <SelectItem key={voice} value={voice}>
                  {Object.hasOwn(labels, voice) ? labels[voice] : voice}
                </SelectItem>
              ))
            : voiceGroups([value.voice, ...voices]).map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.voices.map((voice) => (
                    <SelectItem key={voice} value={voice}>
                      {voice[0]?.toUpperCase()}
                      {voice.slice(1)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
export function choices(settings: Extract<VoiceSettings, { supported: true }>): VoiceChoices {
  return { voice: settings.voice };
}
