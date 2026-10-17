import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  acceptsOperationRoute,
  BRIDGE_PROTOCOL,
  bridgeRoute,
  operationRoute,
} from './bridge-protocol';

describe('bridge protocol catalog', () => {
  it('classifies every operation into real accepted routes and preserves the bounded body classes', () => {
    expect(BRIDGE_PROTOCOL.schema).toBe(1);
    expect(BRIDGE_PROTOCOL.protocol).toBe('hermes-bot-web.v1');
    expect(bridgeRoute('/v1/rpc')?.maxBytes).toBe(65_536);
    expect(bridgeRoute('/v1/avatar')?.maxBytes).toBe(3_000_000);
    expect(bridgeRoute('/v1/files/upload')?.maxBytes).toBe(14 * 1024 * 1024 + 4096);
    expect(bridgeRoute('/v1/arbitrary')).toBeUndefined();
    for (const [operation, definition] of Object.entries(BRIDGE_PROTOCOL.operations)) {
      expect(definition.accepted).toContain(definition.preferred);
      expect(acceptsOperationRoute(operation, '/' + operationRoute(operation))).toBe(true);
      for (const name of definition.accepted) {
        const route = Object.entries(BRIDGE_PROTOCOL.routes).find(([key]) => key === name)?.[1];
        expect(route?.methods).toContain('POST');
        expect(route).toBeDefined();
      }
    }
    for (const operation of [
      'workspace.initialize',
      'bots.appearance.update',
      'agent.onboard',
      'bots.profile.update',
    ]) {
      expect(operationRoute(operation)).toBe('v1/avatar');
      expect(acceptsOperationRoute(operation, '/v1/rpc')).toBe(true);
    }
    for (const operation of ['files.upload', 'files.read'])
      expect(acceptsOperationRoute(operation, '/v1/rpc')).toBe(false);
    expect(acceptsOperationRoute('chat.send', '/v1/avatar')).toBe(false);
    expect(acceptsOperationRoute('arbitrary', '/v1/rpc')).toBe(false);
    expect(() => operationRoute('arbitrary')).toThrow();
    expect(() => operationRoute('constructor')).toThrow();
  });
  it('contains every literal operation called by the production web app and domain port', () => {
    const files = readdirSync(resolve('apps/web/src'), { recursive: true })
      .filter((file) => /\.tsx?$/.test(String(file)))
      .map((file) => resolve('apps/web/src', String(file)));
    files.push(resolve('packages/hermes-client/src/workspace-domain.ts'));
    const called = new Set(
      files.flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/\.invoke\(\s*['"]([a-z][a-z_.]+)['"]/g)].map(
          (match) => match[1],
        ),
      ),
    );
    expect(called.size).toBeGreaterThan(30);
    for (const name of called) expect(Object.hasOwn(BRIDGE_PROTOCOL.operations, name!)).toBe(true);
  });
});
