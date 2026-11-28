import { useRef } from 'react';
import type { RefObject } from 'react';
import { Mic, Play, Square, Upload } from 'lucide-react';
import { AudioActivity } from '../components/ai-elements/audio-activity';
import type { AudioActivityHandle } from '../components/ai-elements/audio-activity';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { LoadingBar } from '../components/ui/loading-bar';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import { SecretCard } from '../components/ai-elements/secret-card';
import { VoiceOptions } from './VoiceOptions';
import type { VoiceChoices } from './VoiceOptions';
import { isVoiceProvider } from './decode';
import type { VoiceProvider, VoiceSettings } from './decode';

export function VoicePanel({
  panel,
  settings,
  value,
  onChange,
  step,
  busy,
  error,
  previewDisabled,
  previewState,
  activity,
  onStopPreview,
  startIntent,
  audioBlocked,
  onEnableAudio,
  onClose,
  onKey,
  onUseSaved,
  onPreview,
  onStart,
  onSave,
  onProvider,
  onImportVox,
}: {
  panel: RefObject<HTMLDivElement | null>;
  settings: VoiceSettings | undefined;
  value: VoiceChoices;
  onChange: (value: VoiceChoices) => void;
  step: 'key' | 'replacement' | 'settings';
  busy: boolean;
  error: string;
  previewDisabled: boolean;
  previewState: 'idle' | 'starting' | 'playing';
  activity: RefObject<AudioActivityHandle | null>;
  onStopPreview: () => void;
  startIntent: boolean;
  audioBlocked: boolean;
  onEnableAudio: () => void;
  onClose: () => void;
  onKey: (value: string) => Promise<void>;
  onUseSaved: () => void;
  onPreview: () => void;
  onStart: () => void;
  onSave: () => void;
  onProvider: (provider: VoiceProvider) => void;
  onImportVox: (file: File) => void;
}) {
  const importFile = useRef<HTMLInputElement>(null);
  const provider = settings?.supported ? settings.provider : 'openai';
  const providerName = provider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI';
  return (
    <Card
      ref={panel}
      aria-label="Voice settings"
      className="w-full gap-4 border-0 bg-transparent py-0 shadow-none"
    >
      <CardContent className="grid gap-4 px-0">
        {!settings && <LoadingBar active label="Loading voice settings" />}
        {settings?.supported === false && (
          <p className="text-sm text-muted-foreground">
            This Hermes build doesn’t support live voice.
          </p>
        )}
        {settings?.supported && settings.providers.length > 1 && (
          <div className="grid justify-items-start gap-2">
            <span className="text-sm font-medium">Voice provider</span>
            <ToggleGroup
              type="single"
              variant="segmented"
              aria-label="Voice provider"
              value={provider}
              disabled={busy || previewState !== 'idle'}
              onValueChange={(value) => {
                if (isVoiceProvider(value)) onProvider(value);
              }}
            >
              <ToggleGroupItem value="openai">OpenAI</ToggleGroupItem>
              <ToggleGroupItem value="elevenlabs">ElevenLabs</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
        {settings?.supported && step !== 'settings' && (
          <>
            {settings.configured && step === 'key' && (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  Use the {providerName} key saved in Hermes for all your pebbles.
                </p>
                <Button onClick={onUseSaved} disabled={busy}>
                  Use saved key
                </Button>
              </div>
            )}
            {settings.canChangeKey && (
              <SecretCard
                title={`${providerName} API key`}
                label="API key"
                description={
                  settings.configured
                    ? `Enter a new ${providerName} API key for voice.`
                    : 'Saved privately in Hermes for all your pebbles.'
                }
                onSubmit={onKey}
                onSkip={onClose}
              />
            )}
            {!settings.canChangeKey && step === 'replacement' && (
              <p className="text-sm text-muted-foreground">
                Ask your Pebble to update the {providerName} key saved in this profile.
              </p>
            )}
          </>
        )}
        {settings?.supported && step === 'settings' && (
          <>
            {previewDisabled && (
              <p className="text-xs text-muted-foreground">
                Changes apply to your next call. Stop the current call to preview.
              </p>
            )}
            <VoiceOptions
              value={value}
              voices={settings.voices}
              provider={provider}
              labels={settings.labels}
              disabled={busy || previewState !== 'idle'}
              onChange={onChange}
            />
            <div className="flex items-center justify-end gap-3">
              <div className="min-w-0 max-w-20 flex-1">
                {previewState === 'starting' ? (
                  <LoadingBar active label="Preparing voice preview" />
                ) : previewState === 'playing' ? (
                  <AudioActivity ref={activity} />
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="quiet"
                  disabled={busy || previewDisabled}
                  onClick={previewState === 'idle' ? onPreview : onStopPreview}
                >
                  {previewState === 'idle' ? <Play /> : <Square />}
                  {previewState === 'idle' ? 'Preview' : 'Stop preview'}
                </Button>
                {!startIntent ? (
                  <Button disabled={busy || previewState !== 'idle'} onClick={onSave}>
                    Save
                  </Button>
                ) : (
                  <Button disabled={busy || previewState !== 'idle'} onClick={onStart}>
                    <Mic />
                    Start call
                  </Button>
                )}
              </div>
            </div>
            {audioBlocked && (
              <Button variant="quiet" onClick={onEnableAudio}>
                Enable preview audio
              </Button>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {provider === 'elevenlabs'
                ? 'ElevenLabs processes call audio and may read replies from Hermes aloud.'
                : 'Calls and previews use your OpenAI account. Call audio and recent chat context go to OpenAI.'}
            </p>
          </>
        )}
        {settings?.supported && provider === 'elevenlabs' && (
          <>
            <input
              ref={importFile}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) onImportVox(file);
              }}
            />
            <Button
              className="justify-self-start"
              variant="quiet"
              disabled={busy || previewState !== 'idle'}
              onClick={() => importFile.current?.click()}
            >
              <Upload /> Import Vox voices
            </Button>
          </>
        )}
        {error && (
          <Alert>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
