import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const checker = join(root, 'scripts/check-system-contract.mjs');
const directory = mkdtempSync(join(tmpdir(), 'pebble-system-guards-'));
function run(cwd) {
  const result = spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}
try {
  const current = run(root);
  if (current.status !== 0) throw new Error(current.stdout + current.stderr);
  cpSync(join(root, 'apps/web/src'), join(directory, 'apps/web/src'), { recursive: true });
  const app = 'apps/web/src/App.tsx';
  const tool = 'apps/web/src/components/ai-elements/tool.tsx';
  const cases = [
    [
      'fixed-height legacy navigation layout',
      'apps/web/src/ui/layout.css',
      (source) => source + '\n.pc-row-open { height: 36px; padding: 8px; }',
    ],
    [
      'custom reaction positioning',
      'apps/web/src/ui/layout.css',
      (source) => source + '\n.pc-reaction { position: absolute; bottom: -8px; }',
    ],
    [
      'handcrafted avatar control',
      'apps/web/src/AgentAvatar.tsx',
      (source) => source.replaceAll('<Toggle', '<button').replaceAll('</Toggle>', '</button>'),
    ],
    [
      'legacy chat layout override',
      'apps/web/src/ui/layout.css',
      (source) => source + '\n.pc-bubble { padding: 13px 16px 8px; }',
    ],
    [
      'unused shared import',
      app,
      (source) =>
        source.replaceAll('<ChatViewport', '<div').replaceAll('</ChatViewport>', '</div>'),
    ],
    [
      'comment or unused helper cannot restore composition',
      app,
      (source) =>
        source.replaceAll('<ChatViewport', '<div').replaceAll('</ChatViewport>', '</div>') +
        '\nfunction unused() { return <ChatViewport />; }\n// <ChatViewport />',
    ],
    [
      'second installed scroller',
      app,
      (source) => source + '\nimport { MessageScroller } from "./components/ui/message-scroller";',
    ],
    [
      'raw native decoding in a screen',
      app,
      (source) =>
        source + '\nfunction regression(client) { return client.invoke("chat.history", {}); }',
    ],
    [
      'AI element owns browser persistence',
      tool,
      (source) => source + '\nlocalStorage.setItem("history", "[]");',
    ],
    [
      'AI element imports transport',
      tool,
      (source) => source + '\nimport { BotBridgeClient } from "@hermes-client/protocol";',
    ],
    [
      'AI element opens a socket',
      tool,
      (source) => source + '\nnew WebSocket("wss://example.invalid");',
    ],
  ];
  for (const [name, path, mutate] of cases) {
    const target = join(directory, path),
      original = readFileSync(target, 'utf8');
    const changed = mutate(original);
    if (changed === original) throw new Error(`Negative control no longer matches: ${name}`);
    writeFileSync(target, changed);
    const result = run(directory);
    writeFileSync(target, original);
    if (result.status === 0 || !result.stderr.includes('Design system contract:'))
      throw new Error(`Guard failed to reject ${name}: ${result.stdout}${result.stderr}`);
    console.log(`Rejected: ${name}`);
  }
  console.log(`Current source accepted; all ${cases.length} negative controls rejected.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
