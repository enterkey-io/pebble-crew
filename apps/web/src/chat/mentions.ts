import type { WorkspaceBot } from '@hermes-client/protocol';
import type { Row } from '../conversation';

export type MentionIndex = ReadonlyMap<string, WorkspaceBot>;
export const noMentions: MentionIndex = new Map();

/** Only enrolled identities and profile-bound local roster aliases are evidence. */
export function messageMentions(
  bots: readonly WorkspaceBot[],
  rooms: readonly Row[],
): MentionIndex {
  const candidates = new Map<string, WorkspaceBot | null>();
  const enrolled = bots.filter((bot) => bot.enrolled && !bot.deleted);
  function add(token: string, bot: WorkspaceBot) {
    const key = token.toLowerCase();
    const previous = candidates.get(key);
    candidates.set(key, previous === undefined || previous?.id === bot.id ? bot : null);
  }
  for (const bot of enrolled) {
    add(bot.handle, bot);
    add(bot.profile, bot);
    if (bot.profile === 'default') add('hermes', bot);
  }
  for (const room of rooms) {
    if (!Array.isArray(room.members)) continue;
    for (const member of room.members) {
      if (!member || typeof member !== 'object') continue;
      const bot = enrolled.find((bot) => bot.profile === member.profile);
      if (!bot || typeof member.handle !== 'string') continue;
      if (
        member.target &&
        (member.target.kind !== 'local' || member.target.profile !== bot.profile)
      )
        continue;
      add(member.handle, bot);
    }
  }
  return new Map([...candidates].flatMap(([key, bot]) => (bot ? [[key, bot]] : [])));
}
