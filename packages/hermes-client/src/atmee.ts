import { ClientError } from '@hermes-client/core';
import { record } from './json';
import type { RpcPort } from './session-client';

export type AtmeeCharacter = { id: string; name: string; ready: boolean };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function configured(data: Record<string, unknown>) {
  if (typeof data.configured !== 'boolean') throw new ClientError('INVALID_RESPONSE');
  return data.configured;
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
}

export type AtmeeRoom = { id: string; url: string; token: string; duration: number };
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
    return { id: data.id, url: data.url, token: data.token, duration: data.duration };
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
