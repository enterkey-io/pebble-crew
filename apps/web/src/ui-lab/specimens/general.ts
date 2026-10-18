import { controlSpecimens } from './controls';
import { surfaceSpecimens } from './surfaces';
import { contentSpecimens } from './content';
import type { GeneralComponentId } from '../catalog';
import type { Specimen } from '../specimen-types';

export const generalSpecimens = {
  ...controlSpecimens,
  ...surfaceSpecimens,
  ...contentSpecimens,
} satisfies Record<GeneralComponentId, Specimen>;
