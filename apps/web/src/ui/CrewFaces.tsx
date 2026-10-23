import { Users } from 'lucide-react';
import type { ReactNode } from 'react';

/** A shared, bounded group portrait. Only the front member needs a live avatar. */
export function CrewFaces({
  members,
  face,
}: {
  members: readonly string[];
  face: (id: string, animated: boolean) => ReactNode;
}) {
  return (
    <span
      className="pc-crew-faces"
      role="img"
      aria-label={`${members.length} members`}
      data-count={Math.min(5, members.length)}
    >
      {members.slice(0, 5).map((id, index) => (
        <span key={id} data-member={index}>
          {face(id, index === 0)}
        </span>
      ))}
      {!members.length && <Users aria-hidden="true" />}
      {members.length > 5 && <small>+{members.length - 5}</small>}
    </span>
  );
}
