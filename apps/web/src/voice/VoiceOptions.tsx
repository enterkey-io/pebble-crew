import { useId } from 'react';
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
import type { VoiceSettings } from './decode';
import { voiceGroups } from './voice-groups';

export type VoiceChoices = { voice: string };
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
          {voiceGroups([value.voice, ...voices]).map((group) => (
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
