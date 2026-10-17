import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { useState } from 'react';
import { ownerRequest } from './owner-request';
import { PersonalPhotoControls } from './OwnerPhoto';
export function OwnerAccount() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <section className="owner-account">
      <h2>Your photo</h2>
      <PersonalPhotoControls />
      <h2>Change password</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage('');
          try {
            if (next !== confirm) throw new Error('The new passwords don’t match.');
            await ownerRequest('/api/auth/change-password', {
              currentPassword: current,
              newPassword: next,
              revokeOtherSessions: true,
            });
            setCurrent('');
            setNext('');
            setConfirm('');
            setMessage('Password changed. Other devices will be signed out within five minutes.');
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Password could not be changed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Current password
          <Input
            required
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          New password
          <Input
            required
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <Input
            required
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <Button disabled={busy}>Change password</Button>
        </div>
      </form>
      <div className="account-devices">
        <div>
          <h2>Other devices</h2>
          <p>End your other signed-in sessions.</p>
        </div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await ownerRequest('/api/auth/revoke-other-sessions', {});
              setMessage('Other devices will be signed out within five minutes.');
            } catch {
              setMessage('Session revocation could not be confirmed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out other devices
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
