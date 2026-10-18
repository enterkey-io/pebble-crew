import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { request as httpsRequest } from 'node:https';
import { resolve, join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'workspace-browser-'));
const state = join(directory, 'owner'),
  cert = join(directory, 'cert.pem'),
  key = join(directory, 'key.pem');
const processes = [];
const env = { ...process.env, WORKSPACE_TEST_STATE: state };
const ownerPort = env.WORKSPACE_TEST_OWNER_PORT ?? '8099';
const ownerBundle = env.WORKSPACE_BUILD_ROOT
  ? join(env.WORKSPACE_BUILD_ROOT, 'owner/main.mjs')
  : 'apps/owner-node/dist/main.mjs';
function start(exe, args, extra = {}) {
  const child = spawn(exe, args, { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (x) => (output += x));
  child.stderr.on('data', (x) => (output += x));
  processes.push({ child, output: () => output });
  return child;
}
async function ready(url) {
  for (let i = 0; i < 300; i++) {
    for (const p of processes)
      if (p.child.exitCode !== null) throw new Error(p.output().slice(-3000));
    try {
      const r = await fetch(url);
      if (r.status !== 502) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Fixture failed to become ready');
}
try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    process.execPath,
    [
      ownerBundle,
      'init',
      '--origin',
      'https://127.0.0.1:5445',
      '--bridge',
      'https://127.0.0.1:8789',
      '--state',
      state,
    ],
    { stdio: 'pipe' },
  );
  start(process.execPath, [
    ownerBundle,
    'serve',
    '--state',
    state,
    '--port',
    ownerPort,
    ...(env.WORKSPACE_BUILD_ROOT ? ['--assets', join(env.WORKSPACE_BUILD_ROOT, 'web')] : []),
  ]);
  start(process.execPath, ['scripts/fixture/owner_tls_proxy.mjs', cert, key, ownerPort]);
  start(
    env.HERMES_NATIVE_PYTHON ?? '/private/tmp/hermes-af0-py314/bin/python',
    [
      'scripts/fixture/native_smoke.py',
      '--serve',
      '--port',
      '8789',
      '--origin',
      'https://127.0.0.1:5445',
      '--cert',
      cert,
      '--key',
      key,
      '--owner-trust',
      join(state, 'trust.json'),
      '--short-leases',
      '--diagnostics',
    ],
    { PYTHONPATH: env.HERMES_NATIVE_ROOT ?? '/private/tmp/hermes-af0-source' },
  );
  // Test readiness uses loopback HTTP. Browser acceptance handles the disposable TLS certificate.
  await ready(`http://127.0.0.1:${ownerPort}/api/instance/status`);
  for (let i = 0; i < 300; i++) {
    const status = await new Promise((r) => {
      const request = httpsRequest(
        'https://127.0.0.1:8789/v1/connect',
        {
          method: 'POST',
          rejectUnauthorized: false,
          headers: { Origin: 'https://127.0.0.1:5445' },
        },
        (response) => {
          response.resume();
          r(response.statusCode);
        },
      );
      request.on('error', () => r(0));
      request.end();
    });
    if (status === 401) break;
    if (i === 299)
      throw new Error(
        'Native bridge did not start: ' +
          processes
            .map((p) => p.output())
            .join('\n')
            .slice(-3000),
      );
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((resolve, reject) => {
    const request = httpsRequest(
      'https://127.0.0.1:8789/fixture/prepare-runtime',
      {
        method: 'POST',
        rejectUnauthorized: false,
        headers: { Origin: 'https://127.0.0.1:5445', Authorization: 'Bearer ' + 'f'.repeat(43) },
      },
      (response) => {
        response.resume();
        response.once('end', () =>
          response.statusCode === 200
            ? resolve()
            : reject(new Error('Native installation preparation failed: ' + response.statusCode)),
        );
      },
    );
    request.setTimeout(60000, () =>
      request.destroy(new Error('Native installation preparation timed out')),
    );
    request.on('error', reject);
    request.end();
  });
  const test = start(process.execPath, [
    resolve('node_modules/@playwright/test/cli.js'),
    'test',
    '--config',
    'playwright.owner.config.ts',
  ]);
  const code = await new Promise((r) => test.once('exit', r));
  const output = processes.find((p) => p.child === test).output();
  console.log(output);
  if (code !== 0) {
    console.log(
      'Synthetic native fixture diagnostics:',
      processes
        .map((p) => p.output())
        .join('\n')
        .slice(-8000),
    );
    process.exitCode = 1;
  }
} finally {
  for (const { child } of processes) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(
    processes.map(({ child }) =>
      child.exitCode === null ? new Promise((r) => child.once('exit', r)) : undefined,
    ),
  );
  await rm(directory, { recursive: true, force: true });
}
