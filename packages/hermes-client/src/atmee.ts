import { ClientError } from '@hermes-client/core';
import { record } from './json';
import type { RpcPort } from './session-client';

export type AtmeeCharacter = { id: string; name: string; ready: boolean };
export type AtmeeVoice =
  { kind: 'existing'; id: string } | { kind: 'designed'; id: string; index: number };
export type AtmeeVoiceChoice = AtmeeVoice | { kind: 'recording'; data: string };
const designStates = ['pending', 'ready', 'failed'] as const;
export type AtmeeVoiceDesign = {
  id: string;
  state: (typeof designStates)[number];
  count: number;
  used: number[];
  error: string | null;
};
const buildStates = ['preparing', 'building', 'ready', 'failed', 'uncertain'] as const;
export type AtmeeBuild = {
  id: string;
  name: string;
  state: (typeof buildStates)[number];
  avatar: string | null;
  error: string | null;
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function readDesign(value: unknown): AtmeeVoiceDesign | null {
  if (value === null) return null;
  const data = record(value);
  const state = designStates.find((candidate) => candidate === data.state);
  if (
    typeof data.id !== 'string' ||
    !uuid.test(data.id) ||
    !state ||
    typeof data.count !== 'number' ||
    !Number.isInteger(data.count) ||
    data.count < 0 ||
    data.count > 6 ||
    (data.error !== null && typeof data.error !== 'string')
  )
    throw new ClientError('INVALID_RESPONSE');
  const used = Array.isArray(data.used)
    ? data.used.filter(
        (index): index is number =>
          typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < 6,
      )
    : [];
  return { id: data.id, state, count: data.count, used, error: data.error };
}

function readBuild(value: unknown): AtmeeBuild | null {
  if (value === null) return null;
  const data = record(value);
  const state = buildStates.find((candidate) => candidate === data.state);
  if (
    typeof data.id !== 'string' ||
    !uuid.test(data.id) ||
    typeof data.name !== 'string' ||
    !data.name ||
    data.name.length > 200 ||
    !state ||
    (data.avatar !== null && (typeof data.avatar !== 'string' || !uuid.test(data.avatar))) ||
    (data.error !== null && (typeof data.error !== 'string' || data.error.length > 512)) ||
    ((state === 'ready' || state === 'building') && !data.avatar)
  )
    throw new ClientError('INVALID_RESPONSE');
  return { id: data.id, name: data.name, state, avatar: data.avatar, error: data.error };
}

function configured(data: Record<string, unknown>) {
  if (typeof data.configured !== 'boolean') throw new ClientError('INVALID_RESPONSE');
  return data.configured;
}

function videoText(value: unknown, limit: number) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit) throw new ClientError('INVALID_RESPONSE');
  return value;
}

export class AtmeeDomain {
  constructor(private readonly bridge: RpcPort) {}
  async status() {
    return configured(record(await this.bridge.invoke('atmee.status', {})));
  }
  async saveKey(value: string) {
    if (!configured(record(await this.bridge.invoke('atmee.key', { value }))))
      throw new ClientError('INVALID_RESPONSE');
  }
  async characters(botId: string) {
    const data = record(await this.bridge.invoke('atmee.avatars', { bot_id: botId }));
    if (
      !Array.isArray(data.avatars) ||
      data.avatars.length > 1000 ||
      (data.selected !== null && (typeof data.selected !== 'string' || !uuid.test(data.selected)))
    )
      throw new ClientError('INVALID_RESPONSE');
    return {
      configured: configured(data),
      selected: data.selected,
      canCreate: data.can_create === true,
      canDesign: data.can_design === true,
      avatars: data.avatars.map((item): AtmeeCharacter => {
        const avatar = record(item);
        if (
          typeof avatar.id !== 'string' ||
          !uuid.test(avatar.id) ||
          typeof avatar.name !== 'string' ||
          !avatar.name ||
          avatar.name.length > 100 ||
          typeof avatar.ready !== 'boolean'
        )
          throw new ClientError('INVALID_RESPONSE');
        return { id: avatar.id, name: avatar.name, ready: avatar.ready };
      }),
    };
  }
  async select(botId: string, avatarId: string) {
    const receipt = record(
      await this.bridge.invoke('atmee.select', { bot_id: botId, avatar_id: avatarId }),
    );
    if (receipt.selected !== avatarId) throw new ClientError('INVALID_RESPONSE');
  }
  async buildProfile(botId: string) {
    const data = record(await this.bridge.invoke('atmee.build.profile', { bot_id: botId }));
    const name = videoText(data.name, 100);
    const persona = videoText(data.persona, 3000);
    if (!name || !persona) throw new ClientError('INVALID_RESPONSE');
    return { name, persona, hasSoul: data.has_soul === true };
  }
  async voiceStatus(botId: string) {
    return readDesign(
      record(await this.bridge.invoke('atmee.voice.status', { bot_id: botId })).design,
    );
  }
  async designVoice(botId: string, requestId: string, name: string, description: string) {
    const data = record(
      await this.bridge.invoke('atmee.voice.design', {
        bot_id: botId,
        request_id: requestId,
        name: name.trim(),
        description: description.trim(),
      }),
    );
    const design = readDesign(data.design);
    if (!design) throw new ClientError('INVALID_RESPONSE');
    return design;
  }
  async sampleVoice(botId: string, voice: AtmeeVoice) {
    const data = record(await this.bridge.invoke('atmee.voice.sample', { bot_id: botId, voice }));
    if (
      typeof data.audio !== 'string' ||
      !data.audio ||
      data.audio.length > 16 * 1024 * 1024 ||
      typeof data.mime !== 'string' ||
      !/^audio\/[a-z0-9-]+$/.test(data.mime)
    )
      throw new ClientError('INVALID_RESPONSE');
    return new Blob([Uint8Array.from(atob(data.audio), (byte) => byte.charCodeAt(0))], {
      type: data.mime,
    });
  }
  async buildStatus(botId: string) {
    return readBuild(
      record(await this.bridge.invoke('atmee.build.status', { bot_id: botId })).build,
    );
  }
  async createCharacter(
    botId: string,
    requestId: string,
    input: {
      name: string;
      persona: string;
      voice: AtmeeVoiceChoice;
      photo: string;
    },
  ) {
    const receipt = record(
      await this.bridge.invoke(
        input.voice.kind === 'recording' ? 'atmee.build.recording' : 'atmee.build.start',
        {
          bot_id: botId,
          request_id: requestId,
          name: input.name.trim(),
          persona: input.persona.trim(),
          voice: input.voice,
          photo: input.photo,
        },
      ),
    );
    const build = readBuild(receipt.build);
    if (!build) throw new ClientError('ATMEE_KEY_REJECTED');
    return build;
  }
}

export type AtmeeRoom = {
  id: string;
  url: string;
  token: string;
  duration: number;
  context: string;
};
export type AtmeeCaption = { id: string; speaker: 'owner' | 'avatar'; text: string };

export class AtmeeCallDomain {
  constructor(
    private readonly bridge: RpcPort,
    private readonly sessionId: string,
  ) {}
  async ready(botId: string) {
    const data = record(await this.bridge.invoke('atmee.ready', { bot_id: botId }));
    if (typeof data.ready !== 'boolean') throw new ClientError('INVALID_RESPONSE');
    return data.ready;
  }
  async start(botId: string): Promise<AtmeeRoom> {
    const data = record(
      await this.bridge.invoke('atmee.start', { session_id: this.sessionId, bot_id: botId }),
    );
    if (
      typeof data.id !== 'string' ||
      !uuid.test(data.id) ||
      typeof data.url !== 'string' ||
      !/^wss:\/\/[\w.-]+\.livekit\.cloud\/?$/i.test(data.url) ||
      typeof data.token !== 'string' ||
      data.token.length < 20 ||
      data.token.length > 8192 ||
      typeof data.duration !== 'number' ||
      !Number.isInteger(data.duration) ||
      data.duration < 1 ||
      data.duration > 300
    )
      throw new ClientError('INVALID_RESPONSE');
    return {
      id: data.id,
      url: data.url,
      token: data.token,
      duration: data.duration,
      context: videoText(data.context, 3858),
    };
  }
  async caption(callId: string, caption: AtmeeCaption) {
    const data = record(
      await this.bridge.invoke('atmee.caption', {
        session_id: this.sessionId,
        call_id: callId,
        line_id: caption.id,
        speaker: caption.speaker,
        text: caption.text,
      }),
    );
    if (data.saved !== true) throw new ClientError('INVALID_RESPONSE');
  }
  delegate(callId: string, lineId: string) {
    return this.bridge.invoke('atmee.delegate', {
      session_id: this.sessionId,
      call_id: callId,
      line_id: lineId,
    });
  }
  async end(callId: string) {
    await this.bridge.invoke('atmee.end', { session_id: this.sessionId, call_id: callId });
  }
}
