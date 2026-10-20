import { Folder, FileText } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { Button } from '../ui/button';
import { Resource } from './resource';
import type { ResourceState } from './states';
export type FileNode =
  | {
      readonly kind: 'folder';
      readonly id: string;
      readonly name: string;
      readonly children: readonly FileNode[];
    }
  | {
      readonly kind: 'file';
      readonly id: string;
      readonly name: string;
      readonly change?: 'added' | 'modified' | 'removed';
      readonly onOpen?: () => void;
    };
function Nodes({ nodes }: { nodes: readonly FileNode[] }) {
  return (
    <ul className="grid gap-1 text-sm">
      {nodes.map((node) => (
        <li key={node.id}>
          {node.kind === 'folder' ? (
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Folder aria-hidden="true" className="size-4" />
                {node.name}
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-5">
                <Nodes nodes={node.children} />
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <div className="flex min-h-9 min-w-0 items-center gap-2 px-2">
              <FileText aria-hidden="true" className="size-4 shrink-0" />
              {node.onOpen ? (
                <Button
                  variant="quiet"
                  size="sm"
                  className="min-w-0 justify-start truncate px-0"
                  onClick={node.onOpen}
                >
                  {node.name}
                </Button>
              ) : (
                <span className="truncate">{node.name}</span>
              )}
              {node.change && (
                <small className="ml-auto text-muted-foreground">{node.change}</small>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
export function FileTree({ value }: { value: ResourceState<readonly FileNode[]> }) {
  return (
    <Resource value={value} empty="No files yet">
      {(nodes) => <Nodes nodes={nodes} />}
    </Resource>
  );
}
