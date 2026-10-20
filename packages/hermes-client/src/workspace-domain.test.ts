import { describe, expect, it, vi } from 'vitest';
import { ClientError } from '@hermes-client/core';
import { WorkspaceDomain } from './workspace-domain';
import type { ProfileEdit } from './workspace-domain';

const role = {
  title: 'Researcher',
  description: 'Explores questions',
  responsibilities: 'Cite sources',
  boundaries: 'Ask before publishing',
  expectedOutputs: 'Brief',
};
const edit: ProfileEdit = {
  target: { profile: 'amy', id: 'incarnation-1' },
  expectedRevision: 5,
  name: 'Amy',
  handle: 'amy',
  appearance: { kind: 'photo', shape: 'seed', color: 'moss' },
  photo: { kind: 'preserve' },
  role,
  manager: 'default',
};

describe('workspace domain commands', () => {
  it('keeps tool, model and Main Pebble uncertainty distinct from confirmed saves', async () => {
    const invoke = vi.fn().mockRejectedValue(new ClientError('REQUEST_TIMEOUT'));
    const domain = new WorkspaceDomain({ invoke });
    expect(
      await domain.attachTools({
        profile: 'amy',
        expectedRevision: 5,
        skills: [],
        toolsets: ['workspace'],
      }),
    ).toMatchObject({ kind: 'uncertain' });
    expect(await domain.selectModel('amy', 5, 'fingerprint')).toMatchObject({ kind: 'uncertain' });
    expect(await domain.selectMainPebble('amy', 5)).toMatchObject({ kind: 'uncertain' });
    expect(invoke).toHaveBeenCalledTimes(3);
    invoke.mockResolvedValue({ configured: false });
    expect(await domain.selectModel('amy', 5, 'fingerprint')).toMatchObject({ kind: 'uncertain' });
    invoke.mockResolvedValue({ configured: true });
    expect(await domain.selectModel('amy', 5, 'fingerprint')).toMatchObject({ kind: 'confirmed' });
  });
  it('saves full profile fields and saved-photo intent without a team field or automatic introduction', async () => {
    const invoke = vi.fn().mockResolvedValue({ state: 'completed', profile: 'amy' });
    const domain = new WorkspaceDomain({ invoke });
    expect(await domain.onboardExisting(edit)).toEqual({
      kind: 'confirmed',
      value: { state: 'completed', profile: 'amy' },
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('agent.onboard', {
      profile: 'amy',
      id: 'incarnation-1',
      expected_revision: 5,
      name: 'Amy',
      handle: 'amy',
      appearance: edit.appearance,
      role,
      manager: 'default',
      photo: null,
    });
  });
  it('keeps a saved photo when a shape is selected and sends a replacement only for photo intent', async () => {
    const invoke = vi.fn().mockResolvedValue({ state: 'completed', profile: 'amy' });
    const domain = new WorkspaceDomain({ invoke });
    await domain.updateProfile({ ...edit, photo: { kind: 'replace', data: 'synthetic-photo' } });
    expect(invoke.mock.calls[0]?.[1].photo).toBe('synthetic-photo');
    await domain.updateProfile({
      ...edit,
      appearance: { ...edit.appearance, kind: 'shape' },
      photo: { kind: 'replace', data: 'synthetic-photo' },
    });
    expect(invoke.mock.calls[1]?.[1].photo).toBeNull();
  });
  it('uses the explicit role assignment operation to preserve team metadata and all role fields', async () => {
    const assignment = { role, manager: 'default', team: 'research' };
    const invoke = vi.fn().mockResolvedValue({ revision: 6, bots: { amy: assignment } });
    const result = await new WorkspaceDomain({ invoke }).updateRoleAssignment({
      profile: 'amy',
      expectedRevision: 5,
      ...assignment,
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('roles.update', {
      profile: 'amy',
      expected_revision: 5,
      ...assignment,
    });
    expect(result).toEqual({ kind: 'confirmed', value: { revision: 6, ...assignment } });
  });
  it.each(['REQUEST_TIMEOUT', 'INVALID_RESPONSE', 'INVALID_PARAMETERS'] as const)(
    'retains mutation uncertainty for %s without replay',
    async (code) => {
      const invoke = vi.fn().mockRejectedValue(new ClientError(code));
      expect(await new WorkspaceDomain({ invoke }).updateProfile(edit)).toEqual({
        kind: 'uncertain',
        evidence: { code },
      });
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects mismatched success receipts and identifies a pre-write revision refusal', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ state: 'completed', profile: 'replaced' })
      .mockRejectedValueOnce(new ClientError('STALE_REVISION'));
    const domain = new WorkspaceDomain({ invoke });
    expect(await domain.updateProfile(edit)).toMatchObject({ kind: 'uncertain' });
    expect(await domain.updateProfile(edit)).toEqual({ kind: 'refused', reason: 'STALE_REVISION' });
  });
});
