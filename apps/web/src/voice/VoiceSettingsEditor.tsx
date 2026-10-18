import { useEffect, useState } from 'react';
import { ConversationDomain } from '@hermes-client/protocol';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { VoiceChat } from './VoiceChat';
import { LoadingBar } from '../components/ui/loading-bar';
import { Alert, AlertDescription } from '../components/ui/alert';

export function VoiceSettingsEditor({
  client,
  profile,
  callActive,
}: {
  client: BotBridgeClient;
  profile: string;
  callActive: boolean;
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
      externalCallActive={callActive}
    />
  );
}
