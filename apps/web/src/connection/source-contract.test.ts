import { expect, it } from 'vitest';
// @ts-expect-error A runtime JS guard consumed by the Node-based build checks.
import { connectionViolations } from '../../../../scripts/check-connection-contract.mjs';
it('rejects the former screen-owned transport even when its import is renamed', () => {
  expect(
    connectionViolations(
      'apps/web/src/App.tsx',
      `import { BotBridgeClient as Connection } from '@hermes-client/protocol'; const client = new Connection(endpoint, token);`,
    ),
  ).toHaveLength(1);
  expect(
    connectionViolations(
      'apps/web/src/connection/session.ts',
      `import { BotBridgeClient } from '@hermes-client/protocol';`,
    ),
  ).toEqual([]);
  expect(
    connectionViolations(
      'apps/web/src/App.tsx',
      `import type { SessionClient } from '@hermes-client/protocol';`,
    ),
  ).toEqual([]);
});
