import { useEffect, useId, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { safeError } from '@hermes-client/core';
import { AtmeeDomain } from '@hermes-client/protocol';
import type {
  AtmeeCharacter,
  AtmeeVoice,
  AtmeeVoiceChoice,
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
  value: AtmeeVoiceChoice | null;
  onChange: (voice: AtmeeVoiceChoice | null) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<'existing' | 'designed' | 'recording'>(
    voices.length ? 'existing' : canDesign ? 'designed' : 'recording',
  );
  const [description, setDescription] = useState('');
  const [design, setDesign] = useState<AtmeeVoiceDesign | null>(null);
  const [designing, setDesigning] = useState(false);
  const [error, setError] = useState('');
  const [loadingSample, setLoadingSample] = useState('');
  const [sample, setSample] = useState<{ key: string; url: string } | null>(null);
  const recordingInput = useRef<HTMLInputElement>(null);
  const recording = useRef<{ file: File; mime: string } | null>(null);
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
      : mode === 'designed' && design?.state === 'ready'
        ? Array.from({ length: design.count }, (_, index) => ({
            name: `Voice ${index + 1}`,
            voice: { kind: 'designed' as const, id: design.id, index },
            key: `${design.id}:${index}`,
          })).filter((option) => !design.used.includes(option.voice.index))
        : [];
  const selected =
    value?.kind === 'designed'
      ? `${value.id}:${value.index}`
      : value?.kind === 'existing'
        ? value.id
        : '';

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

  function chooseRecording(file?: File) {
    sampleRequest.current++;
    setError('');
    setSample(null);
    recording.current = null;
    onChange(null);
    if (!file) return;
    const extension = file.name.toLowerCase().split('.').at(-1);
    const mime =
      extension === 'mp3'
        ? 'audio/mpeg'
        : extension === 'wav'
          ? 'audio/wav'
          : extension === 'm4a'
            ? 'audio/mp4'
            : '';
    if (!mime || !file.size || file.size > 8 * 1024 * 1024) {
      setError('Choose an MP3, M4A or WAV file up to 8 MB.');
      return;
    }
    recording.current = { file, mime };
    setSample({ key: 'recording', url: URL.createObjectURL(new Blob([file], { type: mime })) });
  }

  function acceptRecording(duration: number) {
    const source = recording.current;
    if (!source) return;
    if (!Number.isFinite(duration) || duration < 10 || duration > 60) {
      setError('Choose a recording that is 10–60 seconds long.');
      return;
    }
    const epoch = sampleRequest.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (epoch === sampleRequest.current && typeof reader.result === 'string') {
        const encoded = reader.result.split(',', 2)[1];
        if (encoded) onChange({ kind: 'recording', data: `data:${source.mime};base64,${encoded}` });
      }
    };
    reader.onerror = () => {
      if (epoch === sampleRequest.current)
        setError('The recording couldn’t be read. Choose it again.');
    };
    reader.readAsDataURL(source.file);
  }

  return (
    <div className="grid gap-3">
      <span className="text-sm font-medium">Voice</span>
      {(canDesign || voices.length > 0) && (
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Voice source"
          value={mode}
          onValueChange={(next) => {
            if (next !== 'existing' && next !== 'designed' && next !== 'recording') return;
            setMode(next);
            recording.current = null;
            onChange(null);
            setError('');
            sampleRequest.current++;
            setLoadingSample('');
            setSample(null);
          }}
        >
          {voices.length > 0 && (
            <ToggleGroupItem value="existing">Reuse Atmee voice</ToggleGroupItem>
          )}
          {canDesign && <ToggleGroupItem value="designed">Design a voice</ToggleGroupItem>}
          <ToggleGroupItem value="recording">Upload recording</ToggleGroupItem>
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
      {mode === 'recording' && (
        <div className="grid gap-2">
          <Button
            className="justify-self-start"
            type="button"
            variant="secondary"
            onClick={() => recordingInput.current?.click()}
          >
            {recording.current ? 'Replace recording' : 'Choose recording'}
          </Button>
          <input
            ref={recordingInput}
            aria-label="Voice recording"
            type="file"
            hidden
            accept=".mp3,.m4a,.wav"
            onChange={(event) => {
              chooseRecording(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          <span className="text-xs text-muted-foreground">
            10–60 seconds of clear speech. MP3, M4A or WAV, up to 8 MB.
          </span>
          {sample?.key === 'recording' && (
            <audio
              aria-label="Recording preview"
              className="w-full"
              src={sample.url}
              controls
              preload="metadata"
              onLoadedMetadata={(event) => acceptRecording(event.currentTarget.duration)}
              onError={() => {
                setError('This recording couldn’t play. Choose another file.');
                onChange(null);
              }}
            />
          )}
        </div>
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
