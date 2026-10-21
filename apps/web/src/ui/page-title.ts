import { useEffect } from 'react';

/** The visible page owns the title; undefined delegates to its mounted editor. */
export function usePageTitle(subject: string | undefined) {
  useEffect(() => {
    if (subject !== undefined)
      document.title = subject.trim() ? `${subject.trim()} — Pebble Crew` : 'Pebble Crew';
  }, [subject]);
}
