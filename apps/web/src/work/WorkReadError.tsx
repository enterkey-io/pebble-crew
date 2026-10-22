import { CircleAlert, RefreshCw } from 'lucide-react';
import type { ClientError } from '@hermes-client/core';
import { Alert, AlertAction, AlertTitle, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '../components/ui/empty';

function explanation(error: ClientError) {
  switch (error.code) {
    case 'REQUEST_FAILED':
    case 'DISCONNECTED':
      return 'The connection was interrupted.';
    case 'REQUEST_TIMEOUT':
      return 'Hermes took too long to respond.';
    case 'INVALID_RESPONSE':
    case 'RESPONSE_TOO_LARGE':
      return 'Hermes returned board data this app couldn’t read.';
    case 'UNAUTHORIZED':
      return 'Your Hermes connection needs to be renewed.';
    case 'RPC_FAILED':
      return 'Hermes couldn’t finish the request.';
    case 'INVALID_PARAMETERS':
      return 'Hermes could not open the requested board.';
    default:
      return error.message;
  }
}

export function WorkReadError({
  error,
  subject,
  retained = false,
  onRetry,
  onReconnect,
}: {
  error: ClientError;
  subject: 'this board' | 'project boards';
  retained?: boolean;
  onRetry: () => void;
  onReconnect: () => void;
}) {
  const title = `Couldn’t ${retained ? 'refresh' : 'load'} ${subject}`;
  const reconnect = error.code === 'UNAUTHORIZED' || error.code === 'DISCONNECTED';
  const action = (
    <Button variant="secondary" size="sm" onClick={reconnect ? onReconnect : onRetry}>
      <RefreshCw aria-hidden="true" />
      {reconnect ? 'Reconnect' : 'Try again'}
    </Button>
  );
  return retained ? (
    <Alert
      className="mx-4 my-2 w-auto shrink-0 has-data-[slot=alert-action]:pr-28 md:mx-6"
      data-error-code={error.code}
    >
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{explanation(error)}</AlertDescription>
      <AlertAction>{action}</AlertAction>
    </Alert>
  ) : (
    <Empty role="alert" className="min-h-0 overflow-y-auto" data-error-code={error.code}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlert aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{explanation(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}
