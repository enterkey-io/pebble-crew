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
  ['PebbleEditor.tsx', './components/ui/disclosure', ['Disclosure']],
  ['NewPebble.tsx', './components/ui/disclosure', ['Disclosure']],
  ['OwnerShell.tsx', './components/ui/disclosure', ['Disclosure']],
  ['FirstRun.tsx', './components/ui/disclosure', ['Disclosure']],
  ['chat/RequestReview.tsx', '../components/ui/disclosure', ['Disclosure']],
  ['connections/ConnectionDetail.tsx', '../components/ui/disclosure', ['Disclosure']],
  ['App.tsx', './components/ai-elements/chat', ['Chat', 'ChatViewport']],
  [
    'chat/ConversationInput.tsx',
    '../components/ai-elements/prompt-input',
    ['PromptInputFrame', 'PromptInputField'],
  ],
  ['App.tsx', './chat/ConversationInput', ['ConversationInput']],
  ['App.tsx', './components/ai-elements/confirmation', ['Confirmation']],
  ['chat/Transcript.tsx', '../components/ai-elements/message', ['Message']],
  ['chat/Transcript.tsx', '../components/ai-elements/tool', ['Tool']],
  ['chat/Transcript.tsx', '../components/ai-elements/chain-of-thought', ['ChainOfThought']],
  ['PebbleEditor.tsx', './ui/EditorSurface', ['TabbedEditor']],
  ['WorkspaceSettings.tsx', './ui/EditorSurface', ['TabbedEditor']],
  ['AgentPicker.tsx', './ui/NavigationItem', ['NavigationItem']],
  ['NewPebble.tsx', './ui/NavigationItem', ['NavigationItem']],
  ['AgentAvatar.tsx', './components/ui/toggle', ['Toggle']],
  [
    'ui/NavigationItem.tsx',
    '../components/ui/item',
    ['Item', 'ItemMedia', 'ItemContent', 'ItemTitle', 'ItemDescription'],
  ],
  [
    'ui/ConversationIdentity.tsx',
    '../components/ui/item',
    ['Item', 'ItemMedia', 'ItemContent', 'ItemTitle', 'ItemDescription'],
  ],
  [
    'components/ai-elements/message.tsx',
    '../ui/bubble',
    ['Bubble', 'BubbleContent', 'BubbleReactions'],
  ],
  [
    'ui/WorkspacePanels.tsx',
    '../components/ui/resizable',
    ['ResizablePanelGroup', 'ResizablePanel', 'ResizableHandle'],
  ],
  ['GeneralSettings.tsx', './components/ui/select', ['Select', 'SelectTrigger', 'SelectItem']],
  ['components/ai-elements/secret-card.tsx', './confirmation', ['ApprovalSurface']],
  [
    'voice/VoiceOptions.tsx',
    '../components/ui/select',
    ['Select', 'SelectTrigger', 'SelectItem', 'SelectGroup', 'SelectLabel'],
  ],
  ['voice/VoiceCallBar.tsx', '../components/ui/item', ['Item', 'ItemContent', 'ItemActions']],
  ['voice/VoiceCallBar.tsx', '../components/ai-elements/audio-activity', ['AudioActivity']],
];
for (const path of ['ui/layout.css', 'ui/product.css']) {
  requireRule(
    !/\.pc-(?:bubble|message)(?:[-\s.{:]|$)/m.test(read(path)),
    `${path}: legacy chat geometry must not override the shared Message and Bubble composition.`,
  );
}
requireRule(
  !/<button\b/.test(read('App.tsx')) && !/<button\b/.test(read('AgentAvatar.tsx')),
  'App and avatar controls must use shared controls; native buttons belong inside the owned primitive compositions.',
);
requireRule(
  !/\.pc-row-open|\.pc-row-copy|\.pc-reaction(?:\s|\.|:|\{)|\.pc-(?:voice|secret)-(?:card|options|actions)|\.agent-choice|\.avatar-(?:modes|shapes|colors) button/.test(
    read('ui/layout.css') + read('ui/product.css'),
  ),
  'Remove legacy row, reaction and avatar-control CSS; Item, Bubble and Toggle own their layout and states.',
);
requireRule(
  !/\.pc-(?:voice|secret)-(?:card|options|actions)/.test(read('ui/product.css')),
  'Voice and secret surfaces must use shared kit compositions, without legacy surface overrides.',
);
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
  'chat.commands',
  'chat.command',
  'work.describe',
  'work.board',
  'work.task',
  'work.receipt',
  'work.project.create',
  'work.project.update',
  'work.task.create',
  'work.task.update',
  'work.task.comment',
  'work.task.move',
]);
for (const path of [
  'App.tsx',
  'voice/VoiceChat.tsx',
  'chat/FilesPanel.tsx',
  'work/WorkArea.tsx',
  'work/WorkDialogs.tsx',
  'work/WorkCreator.tsx',
  'work/TaskEditor.tsx',
  'work/use-work.ts',
]) {
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
