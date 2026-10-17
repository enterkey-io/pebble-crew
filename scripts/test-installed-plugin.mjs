// Actual released-package/CLI/supervision acceptance in disposable local infrastructure.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as netServer } from 'node:net';
import { createServer as tlsServer } from 'node:https';
import { request } from 'node:http';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 90000 });
const directory = await mkdtemp(join(tmpdir(), 'workspace-plugin-installed-'));
const source = process.env.HERMES_NATIVE_ROOT ?? '/private/tmp/hermes-af0-source';
const python = process.env.HERMES_NATIVE_PYTHON ?? '/private/tmp/hermes-af0-py314/bin/python';
const checks = {};
let front,
  child,
  browser,
  page,
  diagnostic = '';
async function freePort() {
  const server = netServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function until(read, accept, message, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined)
      throw new Error(diagnostic.slice(-4000));
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch (error) {
      if (error.message.includes('Installed CLI action failed')) throw error;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(message);
}
try {
  const [webPort, bridgePort] = await Promise.all([freePort(), freePort()]);
  const key = join(directory, 'key.pem'),
    cert = join(directory, 'cert.pem');
  const caKey = join(directory, 'ca-key.pem'),
    ca = join(directory, 'ca.pem'),
    csr = join(directory, 'leaf.csr');
  const extensions = join(directory, 'leaf-extensions.txt');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      caKey,
      '-out',
      ca,
      '-days',
      '1',
      '-subj',
      '/CN=Disposable workspace test CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      csr,
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  await writeFile(
    extensions,
    'subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',
  );
  execFileSync(
    'openssl',
    [
      'x509',
      '-req',
      '-in',
      csr,
      '-CA',
      ca,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-out',
      cert,
      '-days',
      '1',
      '-extfile',
      extensions,
    ],
    { stdio: 'ignore' },
  );
  front = tlsServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (incoming, outgoing) => {
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: webPort,
          path: incoming.url,
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode, response.headers);
          outgoing.flushHeaders();
          response.on('error', () => outgoing.end());
          outgoing.on('close', () => response.destroy());
          response.pipe(outgoing);
        },
      );
      upstream.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      outgoing.on('close', () => upstream.destroy());
      incoming.pipe(upstream);
    },
  );
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  const origin = `https://127.0.0.1:${front.address().port}`;
  child = spawn(
    python,
    [
      'scripts/fixture/plugin_install_server.py',
      '--directory',
      directory,
      '--source',
      source,
      '--node',
      process.execPath,
      '--origin',
      origin,
      '--web-port',
      String(webPort),
      '--bridge-port',
      String(bridgePort),
      '--cert',
      ca,
      ...(process.env.WORKSPACE_PLUGIN_ARCHIVE
        ? ['--archive', process.env.WORKSPACE_PLUGIN_ARCHIVE]
        : []),
    ],
    { env: { ...process.env, PYTHONPATH: source }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (x) => (diagnostic += x));
  child.stderr.on('data', (x) => (diagnostic += x));
  const fixture = await until(
    async () => JSON.parse(await readFile(join(directory, 'ready.json'), 'utf8')),
    Boolean,
    'Installed plugin did not become ready',
    240000,
  );
  const state = fixture.state;
  async function control(action) {
    const response = await fetch(`http://127.0.0.1:${fixture.control_port}/${action}`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
  const publicVerified = await control('verify');
  checks.public_https_stream_ready_and_heartbeat = publicVerified.ready;
  browser = await chromium.launch(
    process.env.BOT_WEB_TEST_CHROMIUM ? { executablePath: process.env.BOT_WEB_TEST_CHROMIUM } : {},
  );
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  const origins = new Set(),
    errors = [];
  let connects = 0;
  page.on('response', (response) => {
    if (response.status() === 200 && new URL(response.url()).pathname === '/v1/connect') connects++;
  });
  page.on('request', (r) => origins.add(new URL(r.url()).origin));
  page.on('pageerror', (e) => errors.push(e.message));
  const setupLink = (await readFile(join(state, 'setup-link.txt'), 'utf8')).trim();
  await page.goto(setupLink);
  const pwaAssets = [
    '/manifest.webmanifest',
    '/service-worker.js',
    '/offline.html',
    '/offline.css',
    '/icons/pebble-180.png',
    '/icons/pebble-192.png',
    '/icons/pebble-512.png',
  ];
  for (const path of pwaAssets) {
    const asset = await page.request.get(new URL(path, origin).href);
    expect(asset.ok()).toBe(true);
  }
  checks.packaged_pwa_assets_available = true;
  await expect(page.getByRole('heading', { name: 'Create your login' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/plugin-login.png' });
  checks.setup_link_fragment_removed = new URL(page.url()).hash === '';
  checks.no_setup_code_or_connection_form =
    (await page.getByLabel('Private setup code').count()) === 0 &&
    (await page.getByRole('button', { name: 'Connect my Hermes', exact: true }).count()) === 0;
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-plugin-password-123');
  await page.getByLabel('Confirm password').fill('synthetic-plugin-password-123');
  await page.getByRole('button', { name: 'Create login', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Customize .+|Your existing Hermes agent/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Animated', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Iris', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('checkbox', { name: 'Send an introduction' }).uncheck();
  await page.locator('.handle-input input').fill('aurora');
  await page.getByRole('button', { name: 'White', exact: true }).click();
  await page.getByRole('button', { name: 'Start chatting', exact: true }).click();
  const message = page.getByLabel('Message', { exact: true });
  await expect(message).toBeEnabled();
  await message.fill('Synthetic installed plugin round trip');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Native fixture reply', { exact: true }).last()).toBeVisible();
  checks.actual_native_bot_mode_round_trip = true;
  await page.getByLabel('Choose attachments').setInputFiles({
    name: 'private-fixture.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic private staging probe'),
  });
  await expect(page.locator('.attachment-chips')).toContainText('private-fixture.txt');
  await expect(page.locator('.attachment-chips [data-status=ready]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove private-fixture.txt', exact: true }).click();
  await expect(page.locator('.attachment-chips')).toHaveCount(0);
  checks.actual_combined_authenticated_upload_and_remove = true;
  console.log('Installed package: first use and native Bot Mode reply passed.');
  console.log('Synthetic model audit after first turn:', await control('audit'));
  const cookie = (await context.cookies()).find((c) => c.name.includes('session_token'));
  checks.secure_httponly_strict_owner_session =
    !!cookie?.secure && !!cookie?.httpOnly && cookie?.sameSite === 'Strict';
  const record = () => readFile(join(state, 'service.json'), 'utf8').then(JSON.parse);
  for (const kind of ['owner', 'native', 'bridge', 'manager']) {
    const before = await record();
    const beforeConnects = connects;
    await message.fill(`Unsent draft through ${kind} restart`);
    await control('fault/' + kind);
    await until(
      record,
      (next) => {
        const role = kind === 'native' ? 'bridge' : kind;
        return kind === 'manager'
          ? next.pid !== before.pid
          : typeof next.children[role] === 'number' &&
              next.children[role] !== before.children[role];
      },
      'Supervisor did not replace the failed ' + kind,
    );
    await expect.poll(() => connects).toBeGreaterThan(beforeConnects);
    await expect(message).toBeEnabled();
    await expect(message).toHaveValue(`Unsent draft through ${kind} restart`);
    await expect(page.getByRole('button', { name: 'Connect my Hermes', exact: true })).toHaveCount(
      0,
    );
    checks[kind + '_crash_recovers_without_pairing_and_keeps_draft'] = true;
    console.log('Crash recovery passed:', kind);
  }
  await control('update');
  await expect(message).toBeEnabled();
  await page.reload();
  await expect(message).toBeEnabled();
  await expect(page.getByText('Native fixture reply', { exact: true }).last()).toBeVisible();
  checks.update_preserves_login_and_native_history = true;
  await control('rollback');
  await page.reload();
  await expect(message).toBeEnabled();
  checks.rollback_preserves_login = true;
  console.log('Installed update and explicit rollback passed; testing failed activation.');
  await control('failed-update');
  await page.reload();
  await expect(message).toBeEnabled();
  await expect(page.getByText('Native fixture reply', { exact: true }).last()).toBeVisible();
  checks.failed_activation_rolls_back_with_login_and_history = true;
  console.log('Synthetic model audit after recovery:', await control('audit'));
  const denied = await page.request.post(origin + '/v1/rpc', {
    headers: { Origin: 'https://unapproved.example' },
    data: { operation: 'bots.list', params: {} },
  });
  checks.unapproved_origin_denied = denied.status() === 403;
  const noAuth = await page.request.post(origin + '/v1/connect', { headers: { Origin: origin } });
  checks.owner_cookie_is_not_forwarded_as_bridge_auth = noAuth.status() === 401;
  checks.browser_uses_one_origin = origins.size === 1 && origins.has(origin);
  checks.no_page_errors = errors.length === 0;
  await browser.close();
  browser = undefined;
  await writeFile(join(directory, 'stop'), 'done');
  await new Promise((r) => child.once('exit', r));
  const installation = JSON.parse(
    await readFile(join(directory, 'installation-results.json'), 'utf8'),
  );
  const result = {
    application_revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    source_revision: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    fixture_only: true,
    deterministic_local_model: true,
    package_sha256: installation.package_sha256,
    synthetic_model_turns: installation.synthetic_model_turns,
    installation: installation.checks,
    browser: checks,
    passed: Object.values({ ...installation.checks, ...checks }).every(Boolean),
  };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  console.error('Completed checks:', checks);
  if (page) {
    console.error('Visible headings:', await page.locator('h1').allTextContents());
    await page
      .screenshot({ path: 'artifacts/installed-plugin-failure.png' })
      .catch(() => undefined);
    console.error('Synthetic page state:', (await page.locator('main').innerText()).slice(-2000));
  }
  console.error(diagnostic.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (child && child.exitCode === null) {
    await writeFile(join(directory, 'stop'), 'stop');
    await Promise.race([
      new Promise((r) => child.once('exit', r)),
      new Promise((r) => setTimeout(r, 22000)),
    ]);
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  front?.closeAllConnections();
  if (front?.listening) await new Promise((r) => front.close(r));
  await rm(directory, { recursive: true, force: true });
}
