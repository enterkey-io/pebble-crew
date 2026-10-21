import type { Organization } from '../ui/organization';

export const initialOrganization: Organization = {
  sections: [
    {
      id: 'personal',
      name: 'Personal',
      collapsed: false,
      items: ['sample-0', 'sample-1', 'sample-2', 'sample-3'].map((id) => ({ kind: 'pebble', id })),
    },
    {
      id: 'studio-section',
      name: 'Studio teams',
      collapsed: false,
      items: [{ kind: 'crew', id: 'studio' }],
    },
  ],
  crews: [
    {
      id: 'studio',
      name: 'Studio',
      managerId: null,
      purpose: 'Design and writing',
      collapsed: false,
      members: ['sample-4', 'sample-5'],
    },
  ],
};
