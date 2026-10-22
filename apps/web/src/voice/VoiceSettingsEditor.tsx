import { useLeaseRevision } from '../connection/recovery-context';
import { useEffect, useState } from 'react';
import { ConversationDomain } from '@hermes-client/protocol';
import type { SessionClient } from '@hermes-client/protocol';
import { VoiceChat } from './VoiceChat';
import { LoadingBar } from '../components/ui/loading-bar';
import { Alert, AlertDescription } from '../components/ui/alert';
import type { VoiceSettingsRequest } from './decode';

export function VoiceSettingsEditor({
  client,
  profile,
  callActive,
  request,
  requestResolved,
  onCredentialConfirmed,
  onReady,
  onClose,
}: {
  client: SessionClient;
  profile: string;
  callActive: boolean;
  request?: VoiceSettingsRequest | undefined;
  requestResolved: boolean;
  onCredentialConfirmed: () => void;
  onReady?: (() => void) | undefined;
  onClose: () => void;
}) {
  const recovery = useLeaseRevision();
  const [session, setSession] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void new ConversationDomain(client)
      .open(profile)
      .then((chat) => {
        if (current) setSession(chat.sessionId);
      })
      .catch(() => {
        if (current) setError('Voice settings could not be loaded. Reopen this tab to try again.');
      });
    return () => {
      current = false;
    };
  }, [client, profile, recovery]);
  if (error)
    return (
      <Alert>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!session) return <LoadingBar active label="Loading voice settings" />;
  return (
    <VoiceChat
      key={session}
      client={client}
      sessionId={session}
      running={false}
      onAccepted={() => undefined}
      mode="settings"
      settingsRequest={request}
      requestResolved={requestResolved}
      onCredentialConfirmed={onCredentialConfirmed}
      onReady={onReady}
      onDismiss={onClose}
      externalCallActive={callActive}
    />
  );
}
