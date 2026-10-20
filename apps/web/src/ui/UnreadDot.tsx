export function UnreadDot({ avatar = false }: { avatar?: boolean }) {
  return (
    <span
      className={`unread-dot ${avatar ? 'avatar-unread' : 'row-unread'}`}
      role="img"
      aria-label="Unread messages"
    />
  );
}
