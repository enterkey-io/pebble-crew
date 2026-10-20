import type { Dispatch } from 'react';
import { Notice } from '../ui/primitives';
import { Button } from '../components/ui/button';
import { profileSection } from './edit-session';
import type { ProfileEvent, ProfileSession } from './edit-session';

export function ProfileConflicts({
  edit,
  dispatch,
}: {
  edit: ProfileSession;
  dispatch: Dispatch<ProfileEvent>;
}) {
  const sections = [...new Set(edit.conflicts.map(profileSection))];
  return sections.map((section) => (
    <Notice key={section}>
      The saved {section === 'appearance' ? 'avatar' : section} changed while you were editing.
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={() => dispatch({ type: 'resolve', section, useSaved: true })}
        >
          Use saved version
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => dispatch({ type: 'resolve', section, useSaved: false })}
        >
          Keep my edits
        </Button>
      </div>
    </Notice>
  ));
}
