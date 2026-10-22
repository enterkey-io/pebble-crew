import type { BotBridgeClient } from './bridge';

/** Feature code uses this stable capability port, never transport lifecycle methods. */
export type SessionClient = Omit<
  BotBridgeClient,
  'connect' | 'renew' | 'events' | 'disconnect' | 'health' | 'retire'
>;
export type RpcPort = Pick<SessionClient, 'invoke'>;
