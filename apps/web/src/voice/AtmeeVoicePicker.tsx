import { useEffect, useId, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { safeError } from '@hermes-client/core';
import { AtmeeDomain } from '@hermes-client/protocol';
import type {
  AtmeeCharacter,
  AtmeeVoice,
  AtmeeVoiceDesign,
  SessionClient,
} from '@hermes-client/protocol';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Field, FieldLabel } from '../components/ui/field';
import { LoadingBar } from '../components/ui/loading-bar';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Textarea } from '../components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';

export function AtmeeVoicePicker({
  client,
  botId,
  name,
  voices,
  canDesign,
  value,
  onChange,
}: {
  client: SessionClient;
  botId: string;
  name: string;
  voices: AtmeeCharacter[];
  canDesign: boolean;
  value: AtmeeVoice | null;
  onChange: (voice: AtmeeVoice | null) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<'existing' | 'designed'>(
    voices.length ? 'existing' : 'designed',
  );
  const [description, setDescription] = useState('');
  const [design, setDesign] = useState<AtmeeVoiceDesign | null>(null);
  const [designing, setDesigning] = useState(false);
  const [error, setError] = useState('');
  const [loadingSample, setLoadingSample] = useState('');
  const [sample, setSample] = useState<{ key: string; url: string } | null>(null);
  const requestId = useRef<string | undefined>(undefined);
  const sampleRequest = useRef(0);
  const pending = design?.state === 'pending';
  const sampleUrl = sample?.url;
  useEffect(
    () => () => {
      if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    },
    [sampleUrl],
  );
  useEffect(
    () => () => {
      sampleRequest.current++;
    },
    [],
  );
  useEffect(() => {
    if (!canDesign || mode !== 'designed') return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const value = await new AtmeeDomain(client).voiceStatus(botId);
        if (!mounted) return;
        setDesign(value);
        if (value?.state === 'pending') timer = setTimeout(() => void refresh(), 2500);
      } catch (cause) {
        if (mounted) setError(safeError(cause).message);
      }
    };
    void refresh();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [client, botId, canDesign, mode, pending]);

  const options: { name: string; voice: AtmeeVoice; key: string }[] =
    mode === 'existing'
      ? voices.map((voice) => ({
          name: voice.name,
          voice: { kind: 'existing', id: voice.id },
          key: voice.id,
        }))
      : design?.state === 'ready'
        ? Array.from({ length: design.count }, (_, index) => ({
            name: `Voice ${index + 1}`,
            voice: { kind: 'designed' as const, id: design.id, index },
            key: `${design.id}:${index}`,
          })).filter((option) => !design.used.includes(option.voice.index))
        : [];
  const selected = value?.kind === 'designed' ? `${value.id}:${value.index}` : (value?.id ?? '');

  async function generate() {
    setError('');
    setDesigning(true);
    onChange(null);
    sampleRequest.current++;
    setLoadingSample('');
    setSample(null);
    try {
      requestId.current ??= crypto.randomUUID();
      setDesign(
        await new AtmeeDomain(client).designVoice(botId, requestId.current, name, description),
      );
      requestId.current = undefined;
    } catch (cause) {
      setError(safeError(cause).message);
    } finally {
      setDesigning(false);
    }
  }
  async function preview(key: string, voice: AtmeeVoice) {
    const epoch = ++sampleRequest.current;
    setSample(null);
    setLoadingSample(key);
    setError('');
    try {
      const blob = await new AtmeeDomain(client).sampleVoice(botId, voice);
      if (sampleRequest.current === epoch) setSample({ key, url: URL.createObjectURL(blob) });
    } catch (cause) {
      if (sampleRequest.current === epoch) setError(safeError(cause).message);
    } finally {
      if (sampleRequest.current === epoch) setLoadingSample('');
    }
  }

  return (
    <div className="grid gap-3">
      <span className="text-sm font-medium">Voice</span>
      {canDesign && voices.length > 0 && (
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Voice source"
          value={mode}
          onValueChange={(next) => {
            if (next !== 'existing' && next !== 'designed') return;
            setMode(next);
            onChange(null);
            setError('');
            sampleRequest.current++;
            setLoadingSample('');
            setSample(null);
          }}
        >
          <ToggleGroupItem value="existing">Reuse Atmee voice</ToggleGroupItem>
          <ToggleGroupItem value="designed">Design a voice</ToggleGroupItem>
        </ToggleGroup>
      )}
      {mode === 'designed' && canDesign && (
        <Field>
          <FieldLabel htmlFor={id}>Describe the voice</FieldLabel>
          <Textarea
            id={id}
            rows={2}
            value={description}
            maxLength={1000}
            placeholder="Warm, low voice with a relaxed pace"
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              type="button"
              variant="secondary"
              disabled={designing || pending || !name.trim() || description.trim().length < 20}
              onClick={() => void generate()}
            >
              {designing || pending ? 'Generating…' : 'Generate voice samples'}
            </Button>
            <span className="text-xs text-muted-foreground">Uses Atmee credits.</span>
          </div>
          {(designing || pending) && <LoadingBar active label="Generating voice samples" />}
        </Field>
      )}
      {mode === 'designed' && !canDesign && (
        <p className="text-sm text-muted-foreground">
          Add a voice to an avatar in Atmee, or enable voice generation on your key.
        </p>
      )}
      {options.length > 0 && (
        <RadioGroup
          aria-label="Available voices"
          value={selected}
          onValueChange={(key) => {
            const option = options.find((item) => item.key === key);
            if (option) onChange(option.voice);
          }}
        >
          {options.map((option, index) => (
            <div className="grid gap-2 rounded-lg border border-border px-3 py-2" key={option.key}>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <label
                  htmlFor={`${id}-${index}`}
                  className="flex min-w-0 items-center gap-3 text-sm"
                >
                  <RadioGroupItem id={`${id}-${index}`} value={option.key} />
                  <span className="truncate">{option.name}</span>
                </label>
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  aria-label={`Preview ${option.name}`}
                  disabled={loadingSample === option.key}
                  onClick={() => void preview(option.key, option.voice)}
                >
                  <Play /> Preview
                </Button>
              </div>
              {loadingSample === option.key && <LoadingBar active label="Loading voice sample" />}
              {sample?.key === option.key && (
                <audio
                  controls
                  autoPlay
                  aria-label={`Sample for ${option.name}`}
                  src={sample.url}
                  className="w-full"
                />
              )}
            </div>
          ))}
        </RadioGroup>
      )}
      {(error || (mode === 'designed' && design?.error)) && (
        <Alert>
          <AlertDescription>{error || design?.error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
