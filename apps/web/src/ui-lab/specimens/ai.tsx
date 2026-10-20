import { useState, type ReactNode } from 'react';
import { ChainOfThought } from '../../components/ai-elements/chain-of-thought';
import { Chat, ChatViewport } from '../../components/ai-elements/chat';
import { Checkpoint } from '../../components/ai-elements/checkpoint';
import { Confirmation } from '../../components/ai-elements/confirmation';
import { Context } from '../../components/ai-elements/context';
import { FileTree } from '../../components/ai-elements/file-tree';
import { InlineCitation } from '../../components/ai-elements/inline-citation';
import { Message } from '../../components/ai-elements/message';
import { ModelSelector } from '../../components/ai-elements/model-selector';
import { Plan } from '../../components/ai-elements/plan';
import { PromptInput, type PromptAction } from '../../components/ai-elements/prompt-input';
import { Queue } from '../../components/ai-elements/queue';
import { Reasoning } from '../../components/ai-elements/reasoning';
import { Sources } from '../../components/ai-elements/sources';
import { StackTrace } from '../../components/ai-elements/stack-trace';
import { Subagent } from '../../components/ai-elements/subagent';
import { Suggestion } from '../../components/ai-elements/suggestion';
import { Task } from '../../components/ai-elements/task';
import { Terminal } from '../../components/ai-elements/terminal';
import { TestResults } from '../../components/ai-elements/test-results';
import { Tool } from '../../components/ai-elements/tool';
import { LoadingBar } from '../../components/ui/loading-bar';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { SecretCard } from '../../components/ai-elements/secret-card';
import type { ResourceState } from '../../components/ai-elements/states';
import type { AIPatternId } from '../catalog';

type Action = (label: string) => void;
type Pattern = {
  readonly states: readonly string[];
  render: (state: string, action: Action) => ReactNode;
};
function pattern<const S extends string>(
  states: readonly [S, ...S[]],
  render: (state: S, action: Action) => ReactNode,
): Pattern {
  return {
    states,
    render: (selected, action) =>
      render(states.find((state) => state === selected) ?? states[0], action),
  };
}
const lifecycle = ['pending', 'streaming', 'complete', 'failed', 'cancelled'] as const;
const work = ['pending', 'running', 'complete', 'failed', 'cancelled'] as const;
const notes = [
  {
    kind: 'folder',
    id: 'research',
    name: 'Research',
    children: [{ kind: 'file', id: 'notes', name: 'notes.md', change: 'modified' }],
  },
] as const;
const sources = [
  {
    id: 'docs',
    title: 'Hermes documentation',
    href: 'https://hermes-agent.nousresearch.com/',
    description: 'Explicit source supplied by the provider.',
  },
];
function PromptSample({ state, action }: { state: string; action: Action }) {
  const [draft, setDraft] = useState(state === 'empty' ? '' : 'Plan our next week');
  let intent: PromptAction;
  switch (state) {
    case 'empty':
    case 'uploading':
    case 'sending':
    case 'stopping':
      intent = { kind: state, label: state };
      break;
    case 'running':
      intent = { kind: 'running', onStop: () => action('Stop requested locally') };
      break;
    case 'error':
    case 'draft':
    case 'ready':
      intent = {
        kind: state,
        onSend: () => {
          action('Sent locally');
          setDraft('');
        },
      };
      break;
    default:
      intent = { kind: 'empty', label: 'Unavailable' };
  }
  return <PromptInput value={draft} onValueChange={setDraft} action={intent} />;
}
function resourceSample<T>(
  kind: 'empty' | 'loading' | 'ready' | 'partial' | 'failed',
  value: T,
  message: string,
): ResourceState<T> {
  switch (kind) {
    case 'empty':
      return { kind: 'empty' };
    case 'loading':
      return { kind: 'loading' };
    case 'failed':
      return { kind: 'failed', message };
    case 'ready':
      return { kind: 'ready', value };
    case 'partial':
      return { kind: 'partial', value, message };
  }
}
export const aiSpecimens = {
  'chain-of-thought': pattern(lifecycle, (state) => (
    <ChainOfThought
      state={state}
      steps={[
        {
          id: 'read',
          label: 'Read project notes',
          state: 'complete',
          detail: 'The public notes were opened.',
        },
        {
          id: 'review',
          label: 'Review next steps',
          state:
            state === 'complete'
              ? 'complete'
              : state === 'failed'
                ? 'failed'
                : state === 'cancelled'
                  ? 'cancelled'
                  : 'running',
        },
      ]}
    />
  )),
  chat: pattern(['empty', 'loading', 'ready', 'restoring', 'disconnected', 'manual'], (state) => (
    <Chat
      state={state === 'manual' ? 'ready' : state}
      reader={state === 'manual' ? 'manual' : 'follow'}
      className="h-72"
    >
      {state === 'loading' || state === 'restoring' ? (
        <LoadingBar active />
      ) : (
        <ChatViewport className="space-y-5 p-2">
          {state === 'empty' ? (
            <p className="text-sm text-muted-foreground">No messages yet</p>
          ) : (
            <>
              <Message id="sample-owner" state="committed" role="user" metadata="10:35 AM">
                What is next?
              </Message>
              <Message
                id="sample-agent"
                state="committed"
                role="agent"
                author="Aurora"
                metadata="10:35 AM"
              >
                I have the project notes ready.
              </Message>
            </>
          )}
        </ChatViewport>
      )}
    </Chat>
  )),
  checkpoint: pattern(
    ['available', 'read-only', 'unavailable', 'pending', 'complete', 'failed', 'uncertain'],
    (state, action) => (
      <Checkpoint
        value={
          state === 'unavailable'
            ? {
                kind: 'unavailable',
                reason: 'Checkpoint restoration is not supported by this connection.',
              }
            : state === 'read-only'
              ? { kind: 'read-only', label: 'Before editing notes' }
              : {
                  kind: 'available',
                  label: 'Before editing notes',
                  effect: 'This preview only records your restore choice. No files change.',
                  state: state === 'available' ? 'ready' : state,
                  onRestore: () => action('Restore confirmed locally'),
                }
        }
      />
    ),
  ),
  confirmation: pattern(
    ['pending', 'submitting', 'approved', 'denied', 'expired', 'superseded', 'failed', 'uncertain'],
    (state, action) => (
      <Confirmation
        title="Run this command?"
        description="Read the project directory."
        value={
          state === 'pending'
            ? {
                kind: 'pending',
                onDecision: (choice) =>
                  action(choice === 'once' ? 'Allowed once locally' : 'Denied locally'),
              }
            : {
                kind: state,
                message:
                  state === 'uncertain'
                    ? 'Checking the recorded decision'
                    : state === 'submitting'
                      ? 'Sending decision'
                      : state.charAt(0).toUpperCase() + state.slice(1),
              }
        }
      />
    ),
  ),
  context: pattern(['unknown', 'available', 'stale', 'unavailable'], (state) => (
    <Context
      value={
        state === 'available' || state === 'stale'
          ? { kind: state, used: 24000, capacity: 128000, unit: 'tokens' }
          : { kind: state }
      }
    />
  )),
  'file-tree': pattern(['empty', 'loading', 'ready', 'partial', 'failed'], (state, action) => (
    <FileTree
      value={resourceSample(
        state,
        [
          ...notes,
          {
            kind: 'file' as const,
            id: 'brief',
            name: 'brief.md',
            onOpen: () => action('Opened sample file'),
          },
        ],
        'Some files are unavailable.',
      )}
    />
  )),
  'inline-citation': pattern(['linked', 'plain', 'unavailable'], (state) => (
    <p className="text-sm leading-relaxed">
      The source confirms this detail.{' '}
      <InlineCitation
        source={
          state === 'unavailable'
            ? { kind: 'unavailable', label: 'Source unavailable' }
            : state === 'plain'
              ? { kind: 'plain', label: '1', description: 'An uploaded report' }
              : {
                  kind: 'linked',
                  label: '1',
                  description: 'Hermes documentation',
                  href: 'https://hermes-agent.nousresearch.com/',
                }
        }
      />
    </p>
  )),
  message: pattern(
    ['pending', 'live', 'committed', 'failed', 'cancelled', 'member', 'user'],
    (state) => (
      <Message
        id="sample-message"
        role={state === 'user' ? 'user' : state === 'member' ? 'member' : 'agent'}
        state={state === 'member' || state === 'user' ? 'committed' : state}
        {...(state === 'user' ? {} : { author: 'Aurora' })}
        metadata="10:35 AM"
      >
        {state === 'pending' ? 'Preparing a reply…' : 'The notes are ready for review.'}
      </Message>
    ),
  ),
  'model-selector': pattern(
    ['read-only', 'unavailable', 'choice', 'pending', 'success', 'refused', 'uncertain'],
    (state, action) => (
      <ModelSelector
        value={
          state === 'read-only'
            ? { kind: 'read-only', label: 'Current Hermes model' }
            : state === 'unavailable'
              ? { kind: 'unavailable', reason: 'Model selection unavailable' }
              : {
                  kind: 'choice',
                  state: state === 'choice' ? 'ready' : state,
                  options: [{ value: 'primary-grant', label: 'Primary agent’s model' }],
                  value: 'primary-grant',
                  onSelect: () => action('Selected the available model grant'),
                  ...(state === 'refused'
                    ? { message: 'Hermes refused this change.' }
                    : state === 'uncertain'
                      ? { message: 'Checking the saved model.' }
                      : {}),
                }
        }
      />
    ),
  ),
  plan: pattern(['empty', ...lifecycle], (state) => (
    <Plan
      state={state === 'empty' ? 'complete' : state}
      steps={
        state === 'empty'
          ? []
          : [
              { id: 'notes', title: 'Review notes', state: 'done' },
              {
                id: 'draft',
                title: 'Draft next steps',
                state: state === 'failed' ? 'failed' : state === 'complete' ? 'done' : 'active',
              },
            ]
      }
    />
  )),
  'prompt-input': pattern(
    ['empty', 'draft', 'uploading', 'ready', 'sending', 'running', 'stopping', 'error'],
    (state, action) => <PromptSample key={state} state={state} action={action} />,
  ),
  queue: pattern(
    ['empty', 'queued', 'active', 'complete', 'failed', 'cancelled', 'actionable'],
    (state, action) => (
      <Queue
        items={
          state === 'empty'
            ? []
            : [
                {
                  id: 'queued-work',
                  title: 'Review notes',
                  state: state === 'actionable' ? 'queued' : state,
                  ...(state === 'actionable'
                    ? {
                        cancel: {
                          kind: 'available',
                          action: () => action('Cancelled locally'),
                        } as const,
                      }
                    : {}),
                },
              ]
        }
      />
    ),
  ),
  reasoning: pattern(['absent', ...lifecycle], (state) => (
    <Reasoning
      value={
        state === 'absent'
          ? { kind: 'absent' }
          : {
              kind: 'public-summary',
              state,
              summary: 'I compared the public notes and identified the remaining decisions.',
            }
      }
    />
  )),
  sources: pattern(['empty', 'loading', 'ready', 'partial', 'failed'], (state) => (
    <Sources value={resourceSample(state, sources, 'Some sources are unavailable.')} />
  )),
  'stack-trace': pattern(['empty', 'frames', 'partial', 'malformed'], (state) => (
    <StackTrace
      value={
        state === 'empty'
          ? { kind: 'empty' }
          : state === 'malformed'
            ? { kind: 'malformed', text: 'File not found: notes.md' }
            : {
                kind: state,
                message: 'File not found',
                frames: [
                  { id: 'read', function: 'read_notes', file: 'workspace/notes.py', line: 12 },
                ],
              }
      }
    />
  )),
  subagent: pattern(
    ['requested', 'queued', 'running', 'complete', 'failed', 'cancelled', 'linked'],
    (state, action) => (
      <Subagent
        name="Grace"
        state={state === 'linked' ? 'complete' : state}
        conversation={
          state === 'linked'
            ? { kind: 'available', action: () => action('Opened the sample delegation') }
            : { kind: 'unavailable', reason: 'No conversation receipt' }
        }
      />
    ),
  ),
  suggestion: pattern(['ready', 'selected', 'disabled'], (state, action) => (
    <Suggestion
      value={
        state === 'disabled'
          ? { kind: 'disabled' }
          : { kind: state, onSelect: () => action('Draft: Summarize the project') }
      }
    >
      Summarize the project
    </Suggestion>
  )),
  task: pattern([...work, 'unknown'], (state) => (
    <Task
      title="Review project notes"
      state={state}
      {...(state === 'running' ? { progress: { completed: 2, total: 5, unit: 'files' } } : {})}
      description="The task’s reported status."
    />
  )),
  terminal: pattern(lifecycle, (state) => (
    <Terminal
      command="ls workspace"
      output={
        state === 'pending' ? '' : state === 'failed' ? 'Permission denied' : 'notes.md\nbrief.md'
      }
      state={state}
    />
  )),
  'test-results': pattern(work, (state) => (
    <TestResults
      state={state}
      cases={
        state === 'pending'
          ? []
          : [
              { id: 'first', suite: 'Profiles', name: 'Retains the name', outcome: 'passed' },
              {
                id: 'second',
                suite: 'Profiles',
                name: 'Retains the avatar',
                outcome: state === 'failed' ? 'failed' : 'passed',
              },
              { id: 'third', suite: 'Connections', name: 'Provider check', outcome: 'skipped' },
            ]
      }
    />
  )),
  tool: pattern(
    [
      'pending',
      'input-ready',
      'approval',
      'streaming',
      'complete',
      'failed',
      'denied',
      'cancelled',
      'unknown',
    ],
    (state, action) => (
      <Tool
        id="native-call-1"
        name="Read file"
        state={state}
        input={state === 'pending' ? undefined : '{"path":"notes.md"}'}
        output={
          state === 'complete' ? 'Project notes' : state === 'failed' ? 'File not found' : undefined
        }
        approval={
          <Confirmation
            title="Read notes.md?"
            description="Allow this one file read."
            value={{ kind: 'pending', onDecision: (choice) => action(`Decision: ${choice}`) }}
          />
        }
      />
    ),
  ),
} satisfies Record<AIPatternId, Pattern>;

export function AISpecimenPreview({ id }: { id: AIPatternId }) {
  const definition = aiSpecimens[id];
  const [state, setState] = useState(definition.states[0] ?? '');
  const [receipt, setReceipt] = useState('');
  return (
    <>
      <NativeSelect
        aria-label="AI state"
        value={state}
        onChange={(e) => {
          setState(e.target.value);
          setReceipt('');
        }}
      >
        {definition.states.map((item) => (
          <NativeSelectOption key={item} value={item}>
            {item.replaceAll('-', ' ')}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <div
        data-ai-specimen={id}
        data-mode={state}
        className="mt-5 min-w-0 rounded-2xl bg-card p-5 sm:p-8"
      >
        {definition.render(state, setReceipt)}
      </div>
      <p role="status" className="mt-3 min-h-5 text-xs text-muted-foreground">
        {receipt}
      </p>
    </>
  );
}
export function PrivateRequestSpecimen() {
  const [receipt, setReceipt] = useState('');
  return (
    <>
      <SecretCard
        title="Sample API key"
        label="TEST_DEMO_KEY"
        description="Local preview only. Use a test value."
        onSubmit={async () => {
          setReceipt('Submitted locally; the value was discarded.');
        }}
        onSkip={() => setReceipt('Skipped')}
      />
      <p role="status">{receipt}</p>
    </>
  );
}
