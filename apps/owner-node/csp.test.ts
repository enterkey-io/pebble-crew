import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ownerPolicy } from './csp';

const source = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? source(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );

describe('owner content security policy', () => {
  const policy = ownerPolicy(
    readFileSync('apps/web/public/_headers', 'utf8').match(/Content-Security-Policy: (.*)/)![1]!,
    'https://crew.example.test',
  );
  const connect = policy.match(/connect-src ([^;]*)/)![1]!.split(' ');

  it('allows only this server and the voice providers', () => {
    expect(connect).toEqual([
      "'self'",
      'wss://crew.example.test',
      'wss://api.elevenlabs.io',
      'wss://api.x.ai',
    ]);
  });

  it('allows every socket the app opens directly', () => {
    const sockets = source('apps/web/src').flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/['"`](wss:\/\/[a-z0-9.-]+)/g)].map((m) => m[1]!),
    );
    expect(sockets.length).toBeGreaterThan(1);
    for (const socket of sockets) expect(connect).toContain(socket);
  });
});
