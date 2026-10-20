import { Activity } from './activity';
import { ToolOutput } from './tool';
import type { RunState } from './states';
export function Terminal({
  command,
  output,
  state,
}: {
  command: string;
  output: string;
  state: Exclude<RunState, 'running' | 'unknown'>;
}) {
  return (
    <Activity title={command} state={state}>
      <ToolOutput title="Terminal" value={output} />
    </Activity>
  );
}
