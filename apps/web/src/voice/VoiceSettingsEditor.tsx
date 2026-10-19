import { useEffect, useState } from 'react';
import { ConversationDomain } from '@hermes-client/protocol';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { VoiceChat } from './VoiceChat';
import { LoadingBar } from '../components/ui/loading-bar';
import { Alert, AlertDescription } from '../components/ui/alert';
import type { VoiceSettingsRequest } from './decode';

export function VoiceSettingsEditor({
  client,
  profile,
  callActive,
  request,
  onReady,
  onClose,
}: {
  client: BotBridgeClient;
  profile: string;
  callActive: boolean;
  request?: VoiceSettingsRequest | undefined;
  onReady?: (() => void) | undefined;
  onClose: () => void;
}) {
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
  }, [client, profile]);
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
      onReady={onReady}
      onDismiss={onClose}
      externalCallActive={callActive}
    />
  );
}
