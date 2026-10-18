import { useRef, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { LoadingBar } from '../components/ui/loading-bar';

export function SecretCard({
  title,
  label,
  description,
  onSubmit,
  onSkip,
}: {
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
    <form
      className="pc-secret-card"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        const value = field.current?.value ?? '';
        if (!value || busy) return;
        if (field.current) field.current.value = '';
        setBusy(true);
        setError('');
        void onSubmit(value)
          .catch(() =>
            setError('Couldn’t confirm. Check your Hermes secret storage, then try again.'),
          )
          .finally(() => setBusy(false));
      }}
    >
      <div className="pc-secret-heading">
        <KeyRound size={18} />
        <span>Secrets</span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <label>
        {label}
        <Input
          ref={field}
          type="password"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
          required
          aria-label={label}
        />
      </label>
      {busy && <LoadingBar active label="Submitting secret" />}
      {error && <p role="alert">{error}</p>}
      <footer>
        <small>
          <ShieldCheck size={15} />
          Kept out of this conversation
        </small>
        <Button type="button" variant="quiet" onClick={onSkip} disabled={busy}>
          Skip
        </Button>
        <Button type="submit" disabled={busy}>
          Submit
        </Button>
      </footer>
    </form>
  );
}
