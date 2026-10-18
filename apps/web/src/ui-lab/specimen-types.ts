import type { ComponentType } from 'react';
export type SpecimenMode = 'ready' | 'disabled' | 'error';
export type SpecimenProps = { mode: SpecimenMode };
export type Specimen = ComponentType<SpecimenProps>;
