import type { BotBridgeClient } from '@hermes-client/protocol';
import type { AIPatternId } from '../ui-lab/catalog';

type BridgeFeatures = Pick<
  BotBridgeClient,
  | 'supportsAttachments'
  | 'supportsGeneratedMedia'
  | 'supportsReactions'
  | 'supportsLiveVoice'
  | 'supportsSecrets'
  | 'supportsComputer'
>;
export type PatternSupport = 'available' | 'partial' | 'unverified';
/** Derived per render from the connected bridge and current scope; never persisted. */
export function conversationCapabilities(
  bridge: BridgeFeatures | null | undefined,
  scope: 'bot' | 'room' | 'none',
) {
  const bot = !!bridge && scope === 'bot';
  const attachments = bot && bridge.supportsAttachments;
  const generatedMedia = bot && bridge.supportsGeneratedMedia;
  const reactions = bot && bridge.supportsReactions;
  const voice = bot && bridge.supportsLiveVoice;
  const secrets = bot && bridge.supportsSecrets;
  const patterns = {
    'chain-of-thought': bot ? 'partial' : 'unverified',
    chat: bridge ? 'available' : 'unverified',
    checkpoint: 'unverified',
    confirmation: bridge && scope !== 'none' ? 'available' : 'unverified',
    context: 'unverified',
    'file-tree': attachments ? 'partial' : 'unverified',
    'inline-citation': 'unverified',
    message: bridge ? 'available' : 'unverified',
    'model-selector': 'partial',
    plan: 'unverified',
    'prompt-input': bridge ? 'available' : 'unverified',
    queue: 'unverified',
    reasoning: 'unverified',
    sources: 'unverified',
    'stack-trace': 'unverified',
    subagent: bot ? 'partial' : 'unverified',
    suggestion: 'available',
    task: 'unverified',
    terminal: 'partial',
    'test-results': 'unverified',
    tool: bot ? 'partial' : 'unverified',
  } satisfies Record<AIPatternId, PatternSupport>;
  return { attachments, generatedMedia, reactions, voice, secrets, patterns };
}
