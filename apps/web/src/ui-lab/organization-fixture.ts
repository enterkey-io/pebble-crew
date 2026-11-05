import type { Organization, RailItem } from '../ui/organization';
const rows = (ids: string[]): RailItem[] =>
  ids.map((id) => ({ kind: 'pebble', id, placementId: `row-${id}`, shortcut: false }));
export const initialOrganization: Organization = {
  sections: [
    { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [] },
    {
      id: 'personal',
      name: 'Personal',
      collapsed: false,
      items: rows(['sample-0', 'sample-1', 'sample-2', 'sample-3']),
    },
    { id: 'studio', name: 'Studio', collapsed: false, items: rows(['sample-4', 'sample-5']) },
  ],
};
