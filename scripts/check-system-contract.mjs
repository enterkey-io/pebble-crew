import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { sourceContract } from './ui-source-contract.mjs';

const root = 'apps/web/src/';
const read = (path) => readFileSync(root + path, 'utf8');
const errors = [];
const requireRule = (condition, message) => {
  if (!condition) errors.push(message);
};
const migrated = [
  ['App.tsx', './components/ai-elements/chat', ['Chat', 'ChatViewport']],
  ['App.tsx', './components/ai-elements/prompt-input', ['PromptInputFrame', 'PromptInputField']],
  ['App.tsx', './components/ai-elements/confirmation', ['Confirmation']],
  [
    'chat/Transcript.tsx',
    '../components/ai-elements/message',
    ['MessageBubble', 'MessageMetadata'],
  ],
  ['chat/Transcript.tsx', '../components/ai-elements/tool', ['Tool']],
  ['chat/Transcript.tsx', '../components/ai-elements/chain-of-thought', ['ChainOfThought']],
  ['PebbleEditor.tsx', './ui/EditorSurface', ['TabbedEditor']],
  ['WorkspaceSettings.tsx', './ui/EditorSurface', ['TabbedEditor']],
];
for (const [path, module, components] of migrated) {
  const contract = sourceContract(read(path));
  for (const component of components)
    requireRule(
      contract.renders(component, module),
      `${path} must render shared ${component}; an unused import or helper is insufficient.`,
    );
}
const operations = new Set([
  'chat.history',
  'chat.send',
  'chat.stop',
  'chat.approvals',
  'chat.approval.respond',
  'bot.open',
  'room.messages',
  'room.send',
  'room.approvals',
  'room.approve',
  'room.stop',
  'chat.reactions',
  'chat.react',
  'chat.approve',
  'files.list',
]);
for (const path of ['App.tsx', 'voice/VoiceChat.tsx', 'chat/FilesPanel.tsx']) {
  const contract = sourceContract(read(path));
  requireRule(
    !contract.rawOperations().some((op) => operations.has(op)),
    `${path} must use ConversationDomain for migrated native operations.`,
  );
}
for (const path of readdirSync(root + 'components/ai-elements').filter(
  (path) => path.endsWith('.tsx') || path.endsWith('.ts'),
)) {
  const contract = sourceContract(read('components/ai-elements/' + path));
  requireRule(
    !contract
      .importSources()
      .some((module) => /hermes-client|\/protocol|\/voice\/|\/chat\//.test(module)),
    `${path}: reusable AI elements cannot import native transport or feature state owners.`,
  );
  requireRule(
    !contract
      .calledNames()
      .some((name) =>
        /^(?:fetch|WebSocket|EventSource|XMLHttpRequest)$|(?:^|\.)(?:localStorage|sessionStorage|indexedDB)\.|\.invoke$/.test(
          name,
        ),
      ),
    `${path}: reusable AI elements cannot call transport or browser persistence.`,
  );
}
for (const path of ['App.tsx', 'chat/Transcript.tsx', 'components/ai-elements/chat.tsx']) {
  requireRule(
    !sourceContract(read(path))
      .importSources()
      .some((module) => module.endsWith('/message-scroller')),
    `${path}: TranscriptFollow must remain the sole automatic viewport controller; the registry scroller is catalog-only.`,
  );
}
requireRule(
  sourceContract(read('App.tsx')).calledNames().includes('TranscriptFollow'),
  'The installed conversation must retain TranscriptFollow.',
);
if (errors.length) {
  errors.forEach((error) => console.error('Design system contract: ' + error));
  process.exitCode = 1;
} else {
  execFileSync(process.execPath, ['scripts/sync-ui-catalog.mjs', '--check'], { stdio: 'inherit' });
  console.log(
    'Design system contracts passed: shared production compositions, native boundary and one scroll owner.',
  );
}
