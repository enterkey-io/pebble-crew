export type GeneralComponent = {
  readonly id: string;
  readonly name: string;
  readonly catalog: 'shared' | 'react' | 'vue';
  readonly purpose: string;
};
export type AIPattern = {
  readonly id: string;
  readonly name: string;
  readonly contract: string;
  readonly native: 'existing' | 'partial' | 'adapter' | 'unverified' | 'local';
  readonly evidence: string;
  readonly activation: string;
};
export const catalogSnapshot = '2026-10-17' as const;
export const generalCatalog = [
  {
    id: 'accordion',
    name: 'Accordion',
    catalog: 'shared',
    purpose: 'Role/tool/activity disclosures; preserve controlled expansion through updates.',
  },
  {
    id: 'alert',
    name: 'Alert',
    catalog: 'shared',
    purpose: 'Actionable persistent form/resource errors; never transient reconnect flashes.',
  },
  {
    id: 'alert-dialog',
    name: 'Alert Dialog',
    catalog: 'shared',
    purpose: 'Destructive/unsaved-change confirmation with correct focus return.',
  },
  {
    id: 'aspect-ratio',
    name: 'Aspect Ratio',
    catalog: 'shared',
    purpose: 'Stable photo/media frames and lazy output layout.',
  },
  {
    id: 'attachment',
    name: 'Attachment',
    catalog: 'shared',
    purpose: 'Shared-file selection, upload/reconcile state and message downloads.',
  },
  {
    id: 'avatar',
    name: 'Avatar',
    catalog: 'shared',
    purpose:
      'Primitive frame/fallback around existing Pebble engine or owner photo; preserve custom shapes.',
  },
  {
    id: 'badge',
    name: 'Badge',
    catalog: 'shared',
    purpose: 'Concise factual service/run status; not colorful selection chrome.',
  },
  {
    id: 'breadcrumb',
    name: 'Breadcrumb',
    catalog: 'shared',
    purpose: 'Hierarchical resource/detail context where useful; reserve elsewhere.',
  },
  {
    id: 'bubble',
    name: 'Bubble',
    catalog: 'shared',
    purpose: 'User/assistant presentation with separate avatar-derived owner colors.',
  },
  {
    id: 'button',
    name: 'Button',
    catalog: 'shared',
    purpose: 'Actions across every installed screen.',
  },
  {
    id: 'button-group',
    name: 'Button Group',
    catalog: 'shared',
    purpose: 'Related compact controls such as media and supported modes.',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    catalog: 'shared',
    purpose: 'Ready date selection; reserve until a genuine supported scheduling edit requires it.',
  },
  {
    id: 'card',
    name: 'Card',
    catalog: 'shared',
    purpose: 'Setup/private-request/resource compositions, without card clutter everywhere.',
  },
  {
    id: 'carousel',
    name: 'Carousel',
    catalog: 'shared',
    purpose: 'Ready media sequence specimen; reserve product usage.',
  },
  {
    id: 'chart',
    name: 'Chart',
    catalog: 'shared',
    purpose: 'Ready accessible chart specimen; reserve until real metrics exist.',
  },
  {
    id: 'checkbox',
    name: 'Checkbox',
    catalog: 'shared',
    purpose: 'Membership/tool selection with existing reducer ownership.',
  },
  {
    id: 'code-block',
    name: 'Code Block',
    catalog: 'shared',
    purpose: 'Markdown/tool output, copy/overflow and safe plaintext rendering.',
  },
  {
    id: 'collapsible',
    name: 'Collapsible',
    catalog: 'shared',
    purpose: 'Shared details/activity/provenance expansion.',
  },
  {
    id: 'combobox',
    name: 'Combobox',
    catalog: 'shared',
    purpose: 'Searchable reporting/agent/service choices with authoritative values.',
  },
  {
    id: 'command',
    name: 'Command',
    catalog: 'shared',
    purpose: 'Global search and relevant pickers.',
  },
  {
    id: 'context-menu',
    name: 'Context Menu',
    catalog: 'shared',
    purpose: 'Optional pointer shortcuts backed by the same visible row actions.',
  },
  {
    id: 'data-table',
    name: 'Data Table',
    catalog: 'shared',
    purpose: 'Ready dense-resource composition over Table; actual files/routines only when useful.',
  },
  {
    id: 'date-picker',
    name: 'Date Picker',
    catalog: 'shared',
    purpose:
      'Ready scheduling input; current list/toggle does not require adding a schedule editor.',
  },
  {
    id: 'dialog',
    name: 'Dialog',
    catalog: 'shared',
    purpose: 'Profile/setup/account/confirmation modals.',
  },
  {
    id: 'direction',
    name: 'Direction',
    catalog: 'react',
    purpose:
      'Shared directional primitive; preserve DOM order and keyboard behavior; no claim of completed localization.',
  },
  {
    id: 'drawer',
    name: 'Drawer',
    catalog: 'shared',
    purpose:
      'Phone surface semantics; share existing overlay/history policy and avoid competing Sheet implementation.',
  },
  {
    id: 'dropdown-menu',
    name: 'Dropdown Menu',
    catalog: 'shared',
    purpose: 'Row/account/plus menus; collision and far-edge alignment.',
  },
  {
    id: 'empty',
    name: 'Empty',
    catalog: 'shared',
    purpose:
      'Truthful empty conversation/resources/search; no filler instructions for empty sections.',
  },
  {
    id: 'field',
    name: 'Field',
    catalog: 'shared',
    purpose: 'Shared labels, help only when needed, errors and accessible associations.',
  },
  {
    id: 'form',
    name: 'Form',
    catalog: 'vue',
    purpose:
      'Semantic React form composition using Field/native form and current reducers; no new form-state authority.',
  },
  {
    id: 'hover-card',
    name: 'Hover Card',
    catalog: 'shared',
    purpose: 'Source/profile context with equivalent focus/touch access.',
  },
  {
    id: 'input',
    name: 'Input',
    catalog: 'shared',
    purpose: 'Login, setup, identity, connection and private fields.',
  },
  {
    id: 'input-group',
    name: 'Input Group',
    catalog: 'shared',
    purpose: 'Composer and compact related input/actions.',
  },
  {
    id: 'input-otp',
    name: 'Input OTP',
    catalog: 'shared',
    purpose: 'Ready code input specimen; reserve until real auth requires it.',
  },
  {
    id: 'item',
    name: 'Item',
    catalog: 'shared',
    purpose: 'Consistent service/resource/activity and confirmation rows.',
  },
  {
    id: 'kbd',
    name: 'Kbd',
    catalog: 'shared',
    purpose: 'Real keyboard commands, including organization alternatives.',
  },
  {
    id: 'label',
    name: 'Label',
    catalog: 'shared',
    purpose: 'Accessible controls including concise shape/photo fields.',
  },
  {
    id: 'marker',
    name: 'Marker',
    catalog: 'shared',
    purpose: 'Actual state/step indicators with text alternatives.',
  },
  {
    id: 'menubar',
    name: 'Menubar',
    catalog: 'shared',
    purpose: 'Ready desktop-command specimen; reserve normal app usage.',
  },
  {
    id: 'message',
    name: 'Message',
    catalog: 'shared',
    purpose: 'Base message anatomy used by AI08; one shared family.',
  },
  {
    id: 'message-scroller',
    name: 'Message Scroller',
    catalog: 'shared',
    purpose: 'Catalog anatomy and one proven scroll owner; D1 gate before installed integration.',
  },
  {
    id: 'native-select',
    name: 'Native Select',
    catalog: 'shared',
    purpose: 'Simple platform control where behavior/fit is preferable.',
  },
  {
    id: 'navigation-menu',
    name: 'Navigation Menu',
    catalog: 'shared',
    purpose: 'Ready navigation vocabulary; rail is primary, no redundant menu.',
  },
  {
    id: 'number-field',
    name: 'Number Field',
    catalog: 'vue',
    purpose: 'Accessible React composition for real numeric values; reserve unsupported settings.',
  },
  {
    id: 'pagination',
    name: 'Pagination',
    catalog: 'shared',
    purpose: 'Ready paging; connect only to actual native coverage/cursors.',
  },
  {
    id: 'pin-input',
    name: 'Pin Input',
    catalog: 'vue',
    purpose: 'Semantic alias of code-entry composition, not a second auth state owner.',
  },
  {
    id: 'popover',
    name: 'Popover',
    catalog: 'shared',
    purpose: 'Composer plus, contextual choices and small nonmodal details.',
  },
  {
    id: 'progress',
    name: 'Progress',
    catalog: 'shared',
    purpose: 'Known measurable progress only; never invented percentages.',
  },
  {
    id: 'questionnaire',
    name: 'Questionnaire',
    catalog: 'shared',
    purpose:
      'Ready structured-question states now; native responder remains D4-gated and distinct from secrets.',
  },
  {
    id: 'radio-group',
    name: 'Radio Group',
    catalog: 'shared',
    purpose: 'Exclusive supported choices, avatar shapes/colors where appropriate.',
  },
  {
    id: 'range-calendar',
    name: 'Range Calendar',
    catalog: 'vue',
    purpose: 'React date-range composition; reserve without a supported range workflow.',
  },
  {
    id: 'resizable',
    name: 'Resizable',
    catalog: 'shared',
    purpose: 'Ready detail/resource split geometry; preserve minimum widths and scroll anchoring.',
  },
  {
    id: 'scroll-area',
    name: 'Scroll Area',
    catalog: 'shared',
    purpose: 'Contained nontranscript lists; never another chat scroll controller.',
  },
  {
    id: 'select',
    name: 'Select',
    catalog: 'shared',
    purpose: 'Actual controlled domain choices with retained drafts.',
  },
  {
    id: 'separator',
    name: 'Separator',
    catalog: 'shared',
    purpose: 'Meaningful grouping only; avoid gratuitous dividers.',
  },
  {
    id: 'sheet',
    name: 'Sheet',
    catalog: 'shared',
    purpose: 'Existing phone/detail presentation composed with shared modal/back policy.',
  },
  {
    id: 'sidebar',
    name: 'Sidebar',
    catalog: 'shared',
    purpose: 'Rail organization, pins and navigation, preserving custom semantics.',
  },
  {
    id: 'skeleton',
    name: 'Skeleton',
    catalog: 'shared',
    purpose:
      'Stable genuine loading placeholders; do not replace already-mounted content on reconnect.',
  },
  {
    id: 'slider',
    name: 'Slider',
    catalog: 'shared',
    purpose: 'Ready supported media/numeric control; no invented effort setting.',
  },
  {
    id: 'sonner',
    name: 'Sonner',
    catalog: 'vue',
    purpose:
      'Map toast semantics to the selected React Toast implementation; one notification stack.',
  },
  {
    id: 'spinner',
    name: 'Spinner',
    catalog: 'shared',
    purpose: 'Truthful local pending work with accessible label.',
  },
  {
    id: 'stepper',
    name: 'Stepper',
    catalog: 'vue',
    purpose: 'React ordered-step composition for genuine onboarding stages.',
  },
  {
    id: 'switch',
    name: 'Switch',
    catalog: 'shared',
    purpose: 'Real routine/settings toggles with pending/error state.',
  },
  {
    id: 'table',
    name: 'Table',
    catalog: 'shared',
    purpose: 'Readable markdown/resource tabular data with contained overflow.',
  },
  {
    id: 'tabs',
    name: 'Tabs',
    catalog: 'shared',
    purpose: 'Settings/profile/detail surfaces; fixed editor top and controlled active tab.',
  },
  {
    id: 'tags-input',
    name: 'Tags Input',
    catalog: 'vue',
    purpose: 'React token-entry composition; use only if actual domain supports editable tokens.',
  },
  {
    id: 'textarea',
    name: 'Textarea',
    catalog: 'shared',
    purpose: 'Composer, descriptions and detailed roles; preserve drafts and cursor.',
  },
  {
    id: 'toast',
    name: 'Toast',
    catalog: 'shared',
    purpose:
      'Single transient feedback implementation; persistent errors stay near their controls.',
  },
  {
    id: 'toggle',
    name: 'Toggle',
    catalog: 'shared',
    purpose: 'Actual pressed actions with accessible state.',
  },
  {
    id: 'toggle-group',
    name: 'Toggle Group',
    catalog: 'shared',
    purpose: 'Compact exclusive/multiple choices where domain permits.',
  },
  {
    id: 'tooltip',
    name: 'Tooltip',
    catalog: 'shared',
    purpose: 'Short secondary labels; touch-critical meaning is visible elsewhere.',
  },
  {
    id: 'trace',
    name: 'Trace',
    catalog: 'shared',
    purpose: 'Shared factual tool/activity/run composition underlying AI patterns.',
  },
  {
    id: 'typography',
    name: 'Typography',
    catalog: 'shared',
    purpose: 'System font/spacing/readability, code and markdown rhythm.',
  },
] as const satisfies readonly GeneralComponent[];
export const aiCatalog = [
  {
    id: 'chain-of-thought',
    name: 'Chain of Thought',
    contract:
      '`chain-of-thought.tsx`: collapsed/expanded public activity; pending, streaming, complete, failed, cancelled',
    native: 'partial',
    evidence: 'P, E1',
    activation:
      'Group actual visible activity/tool steps. Never extract provider analysis or label an invented rationale as native reasoning.',
  },
  {
    id: 'chat',
    name: 'Chat',
    contract:
      '`chat.tsx`: empty/loading/ready/restoring/disconnected; live/settled, reader-follow/manual',
    native: 'existing',
    evidence: 'E, E1–E2',
    activation:
      'Installed conversation container. D1 resolves scroller integration; existing controller remains sole authority.',
  },
  {
    id: 'checkpoint',
    name: 'Checkpoint',
    contract:
      '`checkpoint.tsx`: available/read-only/unavailable; restore-confirmation/pending/complete/failed/uncertain',
    native: 'unverified',
    evidence: 'N, E9',
    activation:
      'Prepare real UI now. No rewind/restore button until native checkpoint identity, scope, effects and conflict semantics are verified.',
  },
  {
    id: 'confirmation',
    name: 'Confirmation',
    contract:
      '`confirmation.tsx`: pending/submitting/approved/denied/expired/superseded/failed/uncertain',
    native: 'existing',
    evidence: 'E, E3–E4',
    activation:
      'One visual composition, distinct chat/room/workspace targets. Preserve exact choices, generation and deletion confirmation; never auto-approve or auto-submit a new model turn.',
  },
  {
    id: 'context',
    name: 'Context',
    contract: '`context.tsx`: unknown/available/stale/unavailable; compact/expanded measured usage',
    native: 'unverified',
    evidence: 'N, E9',
    activation:
      'Require actual usage, units and denominator for percentage. Do not substitute total lifetime tokens or guesses for current context use.',
  },
  {
    id: 'file-tree',
    name: 'File Tree',
    contract:
      '`file-tree.tsx`: empty/loading/ready/partial/failure; expanded/selected; optional actual change status',
    native: 'partial',
    evidence: 'P, E6',
    activation:
      'Hierarchy from authorized file records; changed markers only with explicit native provenance. No path discovery from generated prose.',
  },
  {
    id: 'inline-citation',
    name: 'Inline Citation',
    contract: '`inline-citation.tsx`: linked/plain/unavailable source; hover/focus/touch expanded',
    native: 'adapter',
    evidence: 'B, E1/E10',
    activation:
      'Require explicit citation-span/source association. Existing links and search hits do not become citations automatically.',
  },
  {
    id: 'message',
    name: 'Message',
    contract:
      '`message.tsx`: pending/live/committed/failed/cancelled; user/agent/member, attachments and reactions',
    native: 'existing',
    evidence: 'E, E1–E2/E6',
    activation:
      'Preserve native ID, render alias, author, displayed timestamp, files, reaction target and completion controls.',
  },
  {
    id: 'model-selector',
    name: 'Model Selector',
    contract:
      '`model-selector.tsx`: read-only/unavailable/choice; pending/success/refused/uncertain; effort independently available',
    native: 'partial',
    evidence: 'P, E5',
    activation:
      'Existing UI may show/apply the verified primary-model grant. Arbitrary model/provider choice and per-turn effort require separate native support; never send example model names.',
  },
  {
    id: 'plan',
    name: 'Plan',
    contract:
      '`plan.tsx`: empty/pending/streaming/complete/failed/cancelled; step pending/active/done/failed',
    native: 'adapter',
    evidence: 'B, E1/E9',
    activation:
      'Require an explicit structured native plan and stable step identity. No checked checklist inferred from natural language.',
  },
  {
    id: 'prompt-input',
    name: 'Prompt Input',
    contract:
      '`prompt-input.tsx`: empty/draft/uploading/ready/sending/running/stopping/error; attachment reconcile',
    native: 'existing',
    evidence: 'E, E2/E6',
    activation:
      'Existing draft/send/stop/upload semantics, plus File/Photo picker, phone geometry and safe areas. No second useChat store.',
  },
  {
    id: 'queue',
    name: 'Queue',
    contract: '`queue.tsx`: empty/queued/active/complete/failed/cancelled; read-only vs actionable',
    native: 'adapter',
    evidence: 'B, E7/E9',
    activation:
      'Distinguish actual native work queue from upload queue, routines and a queued voice receipt. Reorder/cancel only with verified native operations.',
  },
  {
    id: 'reasoning',
    name: 'Reasoning',
    contract:
      '`reasoning.tsx`: absent/public-summary pending/streaming/complete/failed/cancelled; expandable',
    native: 'adapter',
    evidence: 'B, E1',
    activation:
      'Render only explicitly public summary content. Existing analysis exclusion stays intact; commentary is labeled activity unless its contract identifies a summary.',
  },
  {
    id: 'sources',
    name: 'Sources',
    contract: '`sources.tsx`: empty/loading/ready/partial/error; expanded/collapsed',
    native: 'adapter',
    evidence: 'B, E1/E10',
    activation:
      'Explicit native provenance with safe links only. Arbitrary URLs in prose remain ordinary links.',
  },
  {
    id: 'stack-trace',
    name: 'Stack Trace',
    contract: '`stack-trace.tsx`: empty/frames/partial/malformed; collapsed/expanded',
    native: 'adapter',
    evidence: 'B, E1',
    activation:
      'Known structured tool-error frames, bounded and safe. Keep generic error text when no frame schema is known.',
  },
  {
    id: 'subagent',
    name: 'Subagent',
    contract: '`subagent.tsx`: requested/queued/running/complete/failed/cancelled; linked/unlinked',
    native: 'partial',
    evidence: 'P, E7',
    activation:
      'Preserve exact voice delegation receipts. General agent-to-agent transcripts and nested run links remain inactive until native identities and read authorization are verified. Crew membership is not a spawned run.',
  },
  {
    id: 'suggestion',
    name: 'Suggestion',
    contract: '`suggestion.tsx`: ready/selected/disabled; draft inserted/explicit submit',
    native: 'local',
    evidence: 'L',
    activation:
      'Curated relevant local shortcuts or explicit native suggestions. Default selection fills draft; explicit Send submits. No automatic model call on display.',
  },
  {
    id: 'task',
    name: 'Task',
    contract:
      '`task.tsx`: pending/running/complete/failed/cancelled/unknown; optional native progress',
    native: 'adapter',
    evidence: 'B, E1/E9',
    activation:
      'Actual structured task lifecycle only. Tool completion and a queued delivery do not imply task completion.',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    contract:
      '`terminal.tsx`: pending/streaming/complete/failed/cancelled; bounded output/truncation',
    native: 'partial',
    evidence: 'P/B, E1/E11',
    activation:
      'Known command/output payload can render read-only. Computer access is not an interactive terminal grant; no shell input without explicit native contract.',
  },
  {
    id: 'test-results',
    name: 'Test Results',
    contract:
      '`test-results.tsx`: pending/running/complete/failed/cancelled; passed/failed/skipped suites/cases',
    native: 'adapter',
    evidence: 'B, E1',
    activation:
      'Require native structured test evidence. Exit code zero is not a fabricated suite/pass count.',
  },
  {
    id: 'tool',
    name: 'Tool',
    contract:
      '`tool.tsx`: pending/input-ready/approval/streaming/complete/failed/denied/cancelled/unknown',
    native: 'partial',
    evidence: 'E/P, E1/E3',
    activation:
      'Generic bounded safe output always available; richer known decoders are optional. Preserve native call identity and real supplied fields; missing fields stay absent.',
  },
] as const satisfies readonly AIPattern[];
export type GeneralComponentId = (typeof generalCatalog)[number]['id'];
export type AIPatternId = (typeof aiCatalog)[number]['id'];
