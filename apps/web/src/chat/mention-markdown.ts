import type { Root } from 'mdast';
import { findAndReplace } from 'mdast-util-find-and-replace';
import type { RegExpMatchObject } from 'mdast-util-find-and-replace';
import type { VFile } from 'vfile';
import type { MentionIndex } from './mentions';

const mentionPattern =
  /(?<![\p{L}\p{N}_@\\/.:+-])@([A-Za-z][A-Za-z0-9_-]{0,127})(?![A-Za-z0-9_-])/gu;

function isEscaped(file: VFile, match: RegExpMatchObject) {
  const position = match.stack.at(-1)?.position;
  const start = position?.start.offset;
  const end = position?.end.offset;
  if (start === undefined || end === undefined) return false;
  const source = file.toString().slice(start, end);
  const occurrences = [...source.matchAll(/@/g)];
  const ordinal = match.input.slice(0, match.index).split('@').length - 1;
  const at = occurrences[ordinal]?.index;
  if (at === undefined || occurrences.length !== match.input.split('@').length - 1) return true;
  return (source.slice(0, at).match(/\\+$/)?.[0].length ?? 0) % 2 === 1;
}

export function remarkMentions(mentions: MentionIndex, preserveEscapes: boolean) {
  return (tree: Root, file: VFile) => {
    findAndReplace(
      tree,
      [
        mentionPattern,
        (value: string, token: string, match: RegExpMatchObject) =>
          mentions.has(token.toLowerCase()) && (!preserveEscapes || !isEscaped(file, match))
            ? {
                type: 'link',
                url: '',
                children: [{ type: 'text', value }],
                data: { hName: 'span', hProperties: { 'data-mention-token': token.toLowerCase() } },
              }
            : false,
      ],
      { ignore: ['link', 'linkReference'] },
    );
  };
}
