import type { BotBridgeClient, WorkCatalog, WorkspaceSnapshot } from '@hermes-client/protocol';

export type WorkDialogTarget =
  | { kind: 'new-project' }
  | { kind: 'project'; board: string }
  | { kind: 'new-task'; board: string }
  | { kind: 'task'; board: string; id: string };
export type SharedProps = {
  client: BotBridgeClient;
  catalog: WorkCatalog;
  workspace: WorkspaceSnapshot;
  onClose: () => void;
  onSaved: () => void;
  onOpenBoard: (board: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onNavigate: (action: () => void) => void;
};
