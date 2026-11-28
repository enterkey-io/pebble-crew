import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes } from 'mdast';
import { remarkMedia } from './media-markdown';

const parser = unified().use(remarkParse).use(remarkGfm).freeze();
const previews = new Map<string, string>();
const blockParents = new Set(['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow']);

function readable(node: Nodes): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value;
    case 'code':
      return 'Code snippet';
    case 'html':
      return /<\s*(script|style)\b/i.test(node.value) ? 'Code snippet' : '';
    case 'image':
    case 'imageReference':
      return 'Photo';
    case 'break':
      return ' ';
    case 'definition':
    case 'footnoteDefinition':
      return '';
    default:
      return 'children' in node
        ? node.children.map(readable).join(blockParents.has(node.type) ? ' ' : '')
        : '';
  }
}

/** A bounded, cached text preview; Markdown and HTML are never mounted in a sidebar row. */
export function previewText(input: string): string {
  const source = input.slice(0, 4096);
  if (!source.trim()) return '';
  const cached = previews.get(source);
  if (cached !== undefined) return cached;
  const tree = parser.parse(source);
  remarkMedia()(tree);
  const preview = readable(tree).replace(/\s+/gu, ' ').trim().slice(0, 240) || 'Message';
  previews.set(source, preview);
  if (previews.size > 128) {
    const oldest = previews.keys().next();
    if (!oldest.done) previews.delete(oldest.value);
  }
  return preview;
}
