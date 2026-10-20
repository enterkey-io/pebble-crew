import catalog from '../../../plugins/bot-web/protocol-catalog.json' with { type: 'json' };
import { ClientError } from './errors';

export type BridgeOperation = keyof typeof catalog.operations;
export const BRIDGE_PROTOCOL = catalog;

export function bridgeRoute(path: string) {
  return Object.values(catalog.routes).find((route) => route.path === path);
}

export function operationRoute(operation: string): string {
  const definition = Object.entries(catalog.operations).find(([name]) => name === operation)?.[1];
  const route = Object.entries(catalog.routes).find(
    ([name]) => name === definition?.preferred,
  )?.[1];
  if (!route) throw new ClientError('UNSUPPORTED');
  return route.path.slice(1);
}

export function acceptsOperationRoute(operation: string, path: string): boolean {
  const definition = Object.entries(catalog.operations).find(([name]) => name === operation)?.[1];
  return Object.entries(catalog.routes).some(
    ([name, route]) => route.path === path && definition?.accepted.includes(name),
  );
}
