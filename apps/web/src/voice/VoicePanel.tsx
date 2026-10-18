import type { RefObject } from 'react';
import { AudioLines, Mic, Play, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { LoadingBar } from '../components/ui/loading-bar';
import { SecretCard } from '../components/ai-elements/secret-card';
import { VoiceOptions } from './VoiceOptions';
import type { VoiceChoices } from './VoiceOptions';
import type { VoiceSettings } from './decode';

export function VoicePanel({
  panel,
  settings,
  value,
  onChange,
  step,
  busy,
  error,
  embedded,
  previewDisabled,
  onClose,
  onKey,
  onUseSaved,
  onReplace,
  onPreview,
  onStart,
  onSave,
}: {
  panel: RefObject<HTMLDivElement | null>;
  settings: VoiceSettings | undefined;
  value: VoiceChoices;
  onChange: (value: VoiceChoices) => void;
  step: 'key' | 'settings';
  busy: boolean;
  error: string;
  embedded: boolean;
  previewDisabled: boolean;
  onClose: () => void;
  onKey: (value: string) => Promise<void>;
  onUseSaved: () => void;
  onReplace: () => void;
  onPreview: () => void;
  onStart: () => void;
  onSave: () => void;
}) {
  return (
    <Card
      ref={panel}
      aria-label="Voice settings"
      className={`w-full gap-4 border-0 shadow-none ${embedded ? 'bg-transparent py-0' : ''}`}
    >
      {!embedded && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <AudioLines className="size-4" />
            Voice
          </CardTitle>
          <CardAction>
            <Button variant="quiet" size="icon" aria-label="Close voice setup" onClick={onClose}>
              <X />
            </Button>
          </CardAction>
        </CardHeader>
      )}
      <CardContent className={`grid gap-4 ${embedded ? 'px-0' : ''}`}>
        {!settings && <LoadingBar active label="Loading voice settings" />}
        {settings?.supported === false && (
          <p className="text-sm text-muted-foreground">
            This Hermes build doesn’t support live voice.
          </p>
        )}
        {settings?.supported && step === 'key' && (
          <>
            {settings.configured && (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  An OpenAI key is saved in Hermes. Saved keys are never displayed.
                </p>
                <Button onClick={onUseSaved} disabled={busy}>
                  Use saved key
                </Button>
              </div>
            )}
            {settings.canChangeKey && (
              <SecretCard
                title="OpenAI API key"
                label="API key"
                description={
                  settings.configured
                    ? 'Enter a new key only to replace the saved one.'
                    : 'Saved privately in this Pebble’s Hermes profile.'
                }
                onSubmit={onKey}
                onSkip={onClose}
              />
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
              disabled={busy}
              onChange={onChange}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {settings.canChangeKey ? (
                <Button variant="quiet" size="sm" disabled={busy} onClick={onReplace}>
                  Replace API key
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button variant="quiet" disabled={busy || previewDisabled} onClick={onPreview}>
                  <Play />
                  Preview
                </Button>
                {embedded ? (
                  <Button disabled={busy} onClick={onSave}>
                    Save
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={onStart}>
                    <Mic />
                    Start call
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Calls and previews use your OpenAI account. Call audio and recent chat context go to
              OpenAI.
            </p>
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
