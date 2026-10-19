import type { LucideIcon } from 'lucide-react';
import { toolIcon } from './activity-icons';
import type { ReactNode } from 'react';
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
} from '../ui/code-block';
import { Activity } from './activity';
import type { RunState } from './states';
export type ToolState = RunState | 'input-ready' | 'approval' | 'denied';
export type ToolProps = {
  icon?: LucideIcon | undefined;
  id: string;
  name: string;
  state: ToolState;
  input?: string | undefined;
  output?: string | undefined;
  approval?: ReactNode;
  defaultOpen?: boolean;
};
export function Tool({ id, name, state, input, output, approval, defaultOpen, icon }: ToolProps) {
  const mapped =
    state === 'input-ready' || state === 'approval'
      ? 'pending'
      : state === 'denied'
        ? 'cancelled'
        : state;
  return (
    <div data-tool-id={id} data-tool-state={state} className="min-w-0">
      {state === 'approval' && approval}
      <Activity
        icon={icon ?? toolIcon(name)}
        title={name}
        state={mapped}
        detail={state === 'denied' ? 'Denied' : undefined}
        defaultOpen={defaultOpen}
      >
        {(input || output) && (
          <div className="grid gap-3">
            {input && <ToolOutput title="Input" value={input} />}{' '}
            {output && <ToolOutput title="Output" value={output} />}
          </div>
        )}
      </Activity>
    </div>
  );
}
export function ToolOutput({ title, value }: { title: string; value: string }) {
  const clipped = value.slice(0, 64000);
  return (
    <CodeBlock size="sm">
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={clipped} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-80">
        {clipped}
      </CodeBlockContent>
      {value.length > clipped.length && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">Output truncated</p>
      )}
    </CodeBlock>
  );
}
