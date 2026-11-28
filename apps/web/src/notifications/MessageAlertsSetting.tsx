import { useEffect, useState } from 'react';
import type { SessionClient } from '@hermes-client/protocol';
import { ClientError } from '@hermes-client/core';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '../components/ui/item';
import { Notice } from '../ui/primitives';
import { AlertsBlocked, alertSupport, alertsOn, turnOffAlerts, turnOnAlerts } from './alerts';

/** One switch per device: alerts for new messages while Pebble Crew is closed. */
export function MessageAlertsSetting({ client }: { client: SessionClient }) {
  const support = alertSupport();
  const [on, setOn] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState('');
  useEffect(() => {
    let current = true;
    if (support === 'ready')
      void alertsOn()
        .then((value) => current && setOn(value))
        .catch(() => current && setOn(false));
    return () => {
      current = false;
    };
  }, [support]);
  if (support === 'unsupported') return null;
  async function change(next: boolean) {
    setSaving(true);
    setIssue('');
    try {
      if (next) await turnOnAlerts(client);
      else await turnOffAlerts(client);
      setOn(next);
    } catch (cause) {
      setIssue(
        cause instanceof AlertsBlocked
          ? 'Notifications are blocked. Allow them for Pebble Crew in your device settings.'
          : cause instanceof ClientError && cause.code.startsWith('PUSH_')
            ? cause.message
            : next
              ? 'Alerts could not be turned on. Try again.'
              : 'Alerts could not be turned off. Try again.',
      );
      setOn(await alertsOn().catch(() => false));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Item className="flex-nowrap px-0">
        <ItemContent>
          <ItemTitle>
            <Label htmlFor="message-alerts">Message alerts</Label>
          </ItemTitle>
          <ItemDescription>
            {support === 'install'
              ? 'Add Pebble Crew to your Home Screen, then turn alerts on there.'
              : 'Notify this device of new messages while Pebble Crew is closed.'}
          </ItemDescription>
        </ItemContent>
        {support === 'ready' && (
          <ItemActions>
            <Switch
              id="message-alerts"
              checked={on === true}
              disabled={saving || on === undefined}
              aria-busy={saving}
              onCheckedChange={(next) => void change(next)}
            />
          </ItemActions>
        )}
      </Item>
      {issue && <Notice error>{issue}</Notice>}
    </>
  );
}
