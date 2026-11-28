export function StatusDot({ avatar = false, kind }: { avatar?: boolean; kind: AvatarStatus }) {
  return (
    <span
      className={`status-dot ${avatar ? 'avatar-status' : ''}`}
      data-status={kind}
      data-avatar-badge={avatar ? kind : undefined}
      role="img"
      aria-label={statusLabels[kind]}
    />
  );
}
import { statusLabels, type AvatarStatus } from './avatar-status';
