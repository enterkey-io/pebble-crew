import type { Nodes, PhrasingContent, Root } from 'mdast';

function mediaLine(line: string): PhrasingContent | undefined {
  const match = /^\s*MEDIA:\s*(.+?)\s*$/.exec(line);
  if (!match) return;
  let url = match[1]!;
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'")) ||
    (url.startsWith('<') && url.endsWith('>'))
  )
    url = url.slice(1, -1);
  const name = url.split('/').at(-1) || 'File';
  return /\.(png|jpe?g|webp)$/i.test(url)
    ? { type: 'image', url, alt: name, title: null }
    : { type: 'link', url, title: null, children: [{ type: 'text', value: name }] };
}

export function remarkMedia() {
  return (tree: Root) => {
    function visit(node: Nodes) {
      if (node.type === 'paragraph') {
        const children = node.children;
        node.children = children.flatMap((child, childIndex): PhrasingContent[] => {
          if (child.type !== 'text') return [child];
          const lines = child.value.split('\n');
          return lines.flatMap((line, index): PhrasingContent[] => [
            ...(index ? [{ type: 'text' as const, value: '\n' }] : []),
            ((index > 0 || childIndex === 0 || children[childIndex - 1]?.type === 'break') &&
            (index < lines.length - 1 ||
              childIndex === children.length - 1 ||
              children[childIndex + 1]?.type === 'break')
              ? mediaLine(line)
              : undefined) ?? { type: 'text', value: line },
          ]);
        });
      } else if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}
