import { useRef, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { ApprovalSurface } from './confirmation';
import { Form } from '../ui/form';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { LoadingBar } from '../ui/loading-bar';
import { Alert, AlertDescription } from '../ui/alert';

export function SecretCard({
  title,
  label,
  description,
  onSubmit,
  onSkip,
  initialValue = '',
  onValueChange,
}: {
  initialValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  title: string;
  label: string;
  description: string;
  onSubmit: (value: string) => Promise<void>;
  onSkip: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <ApprovalSurface title={title} description={description} icon={KeyRound}>
      <Form
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault();
          const value = field.current?.value ?? '';
          if (!value || busy) return;
          if (field.current) field.current.value = '';
          onValueChange?.('');
          setBusy(true);
          setError('');
          void onSubmit(value)
            .catch(() => setError('The key could not be saved. Try again.'))
            .finally(() => setBusy(false));
        }}
      >
        <Label layout="stacked">
          {label}
          <Input
            ref={field}
            defaultValue={initialValue}
            onChange={(event) => onValueChange?.(event.target.value)}
            type="password"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            required
            aria-label={label}
          />
        </Label>
        {busy && <LoadingBar active label="Saving secret" />}
        {error && (
          <Alert>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <small className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Kept out of chat
          </small>
          <Button type="button" variant="quiet" onClick={onSkip} disabled={busy}>
            Skip
          </Button>
          <Button type="submit" disabled={busy}>
            Submit
          </Button>
        </div>
      </Form>
    </ApprovalSurface>
  );
}
