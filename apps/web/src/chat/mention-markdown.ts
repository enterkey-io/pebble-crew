import type { Nodes, Root, Text } from 'mdast';
import { findAndReplace } from 'mdast-util-find-and-replace';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { MentionIndex } from './mentions';

const mentionPattern =
  /(?<![\p{L}\p{N}_@\\/.:+-])@([A-Za-z][A-Za-z0-9_-]{0,127})(?![A-Za-z0-9_-])/gu;
const parser = unified().use(remarkParse).use(remarkGfm);

function visitText(node: Nodes, visit: (text: Text) => void) {
  if (node.type === 'text') visit(node);
  else if ('children' in node && node.type !== 'link' && node.type !== 'linkReference')
    node.children.forEach((child) => visitText(child, visit));
}

function tokens(text: string, mentions: MentionIndex) {
  return [...text.matchAll(mentionPattern)].flatMap((match) => {
    const bot = mentions.get(match[1]!.toLowerCase());
    return bot
      ? [{ start: match.index, end: match.index + match[0].length, text: match[0], bot }]
      : [];
  });
}

export function remarkMentions(mentions: MentionIndex) {
  return (tree: Root) => {
    findAndReplace(
      tree,
      [
        mentionPattern,
        (value: string, token: string) =>
          mentions.has(token.toLowerCase())
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

/** Offsets into the original owner text preserve every whitespace and Markdown character. */
export function plainMentions(text: string, mentions: MentionIndex) {
  const result: ReturnType<typeof tokens> = [];
  if (!mentions.size) return result;
  visitText(parser.parse(text), (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    for (const token of tokens(text.slice(start, end), mentions))
      result.push({ ...token, start: start + token.start, end: start + token.end });
  });
  return result;
}
