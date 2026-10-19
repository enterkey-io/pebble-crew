import { describe, expect, it } from 'vitest';
import {
  roleInstructions,
  withRoleInstructions,
  ROLE_INSTRUCTIONS_LIMIT,
} from './role-instructions';
import { decodeRole } from './workspace';

const original = {
  title: 'Researcher',
  description: 'Finds sources',
  responsibilities: 'Read sources.',
  boundaries: 'Ask before publishing.',
  expectedOutputs: 'A short brief.',
};

describe('one role instruction field', () => {
  it('retains every saved legacy instruction and leaves metadata alone', () => {
    const text = roleInstructions(original);
    expect(text).toBe(
      'Read sources.\n\nBoundaries:\nAsk before publishing.\n\nExpected outputs:\nA short brief.',
    );
    const consolidated = withRoleInstructions(original, text);
    expect(roleInstructions(consolidated)).toBe(text);
    expect(consolidated.title).toBe(original.title);
    expect(consolidated.description).toBe(original.description);
    expect(original.boundaries).toBe('Ask before publishing.');
  });
  it('accepts a full job instruction and rejects oversized native responses', () => {
    const role = withRoleInstructions(original, 'a'.repeat(ROLE_INSTRUCTIONS_LIMIT));
    expect(decodeRole(role)).toEqual(role);
    expect(() => decodeRole({ ...role, responsibilities: role.responsibilities + 'a' })).toThrow();
    expect(roleInstructions(withRoleInstructions(original, ''))).toBe('');
  });
});
