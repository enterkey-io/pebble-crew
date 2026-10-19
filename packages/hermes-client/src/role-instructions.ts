import type { Role } from './workspace';

export const ROLE_INSTRUCTIONS_LIMIT = 12000;
export const roleInstructionFields = ['responsibilities', 'boundaries', 'expectedOutputs'] as const;

export function roleInstructions(role: Role): string {
  return [
    role.responsibilities,
    role.boundaries && `Boundaries:\n${role.boundaries}`,
    role.expectedOutputs && `Expected outputs:\n${role.expectedOutputs}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

export function withRoleInstructions(role: Role, instructions: string): Role {
  return { ...role, responsibilities: instructions, boundaries: '', expectedOutputs: '' };
}
