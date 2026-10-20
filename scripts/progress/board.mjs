import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, open } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const statePath = resolve(
  process.env.PEBBLE_BOARD_STATE ??
    resolve(directory, '../../.audit/shadcn-implementation/status.json'),
);
const statuses = new Set(['todo', 'doing', 'done', 'waiting', 'blocked']);
async function readState() {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (
    state.project !== 'Pebble Crew' ||
    !Number.isSafeInteger(state.revision) ||
    !Array.isArray(state.phases)
  )
    throw new Error('Invalid board state');
  return state;
}
async function save(state) {
  state.revision += 1;
  state.updatedAt = new Date().toISOString();
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, statePath);
}
async function initialize() {
  try {
    return await readState();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const definitions = JSON.parse(await readFile(resolve(directory, 'phases.json'), 'utf8'));
  const state = {
    project: 'Pebble Crew',
    revision: 0,
    updatedAt: '',
    waiting: null,
    phases: definitions.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map(([id, title]) => ({
        id,
        title,
        status: id === 'dashboard.build' ? 'doing' : 'todo',
        note: '',
      })),
    })),
  };
  await save(state);
  return state;
}
const [command = 'serve', id, value, ...note] = process.argv.slice(2);
if (command === 'init') {
  const state = await initialize();
  process.stdout.write(`Progress board ready: ${state.phases.length} phases\n`);
} else if (['update', 'wait', 'unwait'].includes(command)) {
  const state = await readState();
  const task = state.phases.flatMap((phase) => phase.tasks).find((item) => item.id === id);
  if (!task) throw new Error(`Unknown task: ${id}`);
  if (command === 'wait') {
    const question = [value, ...note].filter(Boolean).join(' ').trim();
    if (!question || question.length > 600) throw new Error('A concise owner question is required');
    state.waiting = { taskId: id, question };
    task.status = 'waiting';
  } else if (command === 'unwait') {
    if (state.waiting?.taskId === id) state.waiting = null;
    task.status = 'doing';
  } else {
    if (!statuses.has(value) || value === 'waiting')
      throw new Error('Use todo, doing, done or blocked; use wait for an owner question');
    task.status = value;
    task.note = note.join(' ').slice(0, 600);
    if (state.waiting?.taskId === id) state.waiting = null;
  }
  await save(state);
  process.stdout.write(`${id}: ${task.status}\n`);
} else if (command === 'start') {
  await initialize();
  const address = `http://127.0.0.1:${process.env.PEBBLE_BOARD_PORT ?? 8096}/state`;
  async function running() {
    try {
      const response = await fetch(address, { signal: AbortSignal.timeout(300) });
      return response.ok && (await response.json()).project === 'Pebble Crew';
    } catch {
      return false;
    }
  }
  if (await running()) {
    process.stdout.write(`Progress board already running: ${address}\n`);
    process.exit(0);
  }
  const log = await open(resolve(dirname(statePath), 'server.log'), 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
    env: process.env,
  });
  child.unref();
  await log.close();
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await running()) {
      ready = true;
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) {
    child.kill();
    throw new Error('Progress server did not start; inspect its server.log');
  }
  await writeFile(resolve(dirname(statePath), 'server.pid'), String(child.pid), { mode: 0o600 });
  process.stdout.write(`Progress board running (${child.pid}): ${address}\n`);
} else if (command === 'serve') {
  let state = await initialize();
  const clients = new Set();
  const send = (response) => response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  watchFile(statePath, { interval: 500 }, async () => {
    try {
      const next = await readState();
      if (next.revision <= state.revision) return;
      state = next;
      for (const response of clients) send(response);
    } catch (error) {
      process.stderr.write(`Progress state could not be read: ${error.message}\n`);
    }
  });
  const files = new Map([
    ['/', ['index.html', 'text/html']],
    ['/style.css', ['style.css', 'text/css']],
    ['/client.js', ['client.js', 'text/javascript']],
  ]);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    const path = new URL(request.url, 'http://progress.invalid').pathname;
    if (path === '/events' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
      response.write('retry: 1500\n\n');
      clients.add(response);
      send(response);
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
      request.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(response);
      });
      return;
    }
    if (path === '/state') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(request.method === 'HEAD' ? undefined : JSON.stringify(state));
      return;
    }
    const file = files.get(path);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    try {
      const data = await readFile(resolve(directory, file[0]));
      response
        .writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` })
        .end(request.method === 'HEAD' ? undefined : data);
    } catch {
      response.writeHead(500).end();
    }
  });
  server.listen(Number(process.env.PEBBLE_BOARD_PORT ?? 8096), '127.0.0.1', () => {
    process.stdout.write(`Progress board: http://127.0.0.1:${server.address().port}\n`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      unwatchFile(statePath);
      for (const response of clients) response.end();
      server.close(() => process.exit(0));
    });
} else throw new Error('Use init, start, serve, update, wait or unwait');
