from copy import deepcopy
import json
import unittest
import uuid
import test_workspace as fixture
from bot_web.operations import InvalidOperation
from bot_web.workspace import WorkspaceStore, WorkspaceService
from bot_web.operations import BotOperations
from bot_web.organization import agent_edit, reconcile


class OrganizationTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixture.WorkspaceTests.asyncSetUp
    asyncTearDown = fixture.WorkspaceTests.asyncTearDown

    async def save(self, org, expected=None, operation=None):
        value = {k: deepcopy(org[k]) for k in ('schema', 'sections')}
        return await self.service.invoke('organization.save', {'organization': value,
            'expected_revision': org['revision'] if expected is None else expected, 'operation_id': operation or str(uuid.uuid4())})

    async def test_layout_receipts_are_idempotent_and_never_write_native_profiles_or_rooms(self):
        org = await self.service.invoke('organization.get', {})
        state = deepcopy(self.store.read())
        changed = deepcopy(org)
        changed['sections'].append({'id': 'section-studio', 'name': 'Studio', 'collapsed': False, 'items': []})
        changed['sections'][1]['items'].append(changed['sections'][0]['items'].pop())
        op = str(uuid.uuid4()); before = len(self.native.calls)
        saved = await self.save(changed, operation=op)
        self.assertEqual(saved, await self.save(changed, operation=op))
        self.assertEqual(self.store.read(), state)
        self.assertFalse(any(m in {'profiles.configure', 'groups.create', 'groups.send', 'prompt.submit'} for m, _ in self.native.calls[before:]))
        second = WorkspaceStore(self.path)
        try:
            service = WorkspaceService(BotOperations(self.native), second)
            self.assertEqual(await service.invoke('organization.get', {}), saved)
        finally: second.db.close()
        with self.assertRaises(InvalidOperation): await self.save(org)
        changed['sections'][1]['name'] = 'Other'
        with self.assertRaises(InvalidOperation): await self.save(changed, operation=op)

    async def test_exact_legacy_conversion_preserves_shortcuts_roles_pins_and_room_provenance(self):
        state = self.store.read(); ids = [b['id'] for b in state['bots'].values()]
        old = {'schema': 2, 'revision': 8, 'sections': [
            {'id': 'pebbles', 'name': 'Pebbles', 'collapsed': False, 'items': [{'kind': 'pebble', 'id': ids[0]}]},
            {'id': 'work', 'name': 'Work', 'collapsed': False, 'items': [{'kind': 'crew', 'id': 'ops'}]}],
            'crews': [{'id': 'ops', 'name': 'Operations', 'purpose': 'Old private purpose', 'managerId': ids[0], 'collapsed': True, 'members': ids}]}
        raw = json.dumps(old, indent=3)
        provenance = '{"ops":{"room_id":"original-room","created_at":1700000000.123456}}'
        with self.store.db:
            self.store.db.execute("DELETE FROM presentation WHERE key IN ('sidebar-before-sections','sidebar-retirement')")
            self.store.db.execute("INSERT OR REPLACE INTO presentation VALUES('organization',?)", (raw,))
            self.store.db.execute("INSERT OR REPLACE INTO presentation VALUES('crew-chats',?)", (provenance,))
        before = len(self.native.calls)
        converted = await self.service.invoke('organization.get', {})
        self.assertEqual(converted['schema'], 3); self.assertEqual(converted['revision'], 9)
        self.assertEqual([s['name'] for s in converted['sections']], ['Pebbles', 'Work', 'Operations'])
        self.assertEqual([i['id'] for i in converted['sections'][2]['items']], ids)
        self.assertTrue(converted['sections'][2]['collapsed'])
        self.assertTrue(converted['sections'][0]['items'][0]['shortcut'])
        self.assertEqual(len({i['placementId'] for s in converted['sections'] for i in s['items']}), 3)
        archive = json.loads(self.store.db.execute("SELECT value FROM presentation WHERE key='sidebar-before-sections'").fetchone()[0])
        self.assertEqual(archive['organization'], raw); self.assertEqual(archive['crew_chats'], provenance)
        self.assertEqual(await self.service.invoke('organization.get', {}), converted)
        self.assertEqual(self.store.read(), state)
        self.assertFalse(any(m in {'groups.create', 'groups.state', 'groups.send', 'profiles.configure', 'prompt.submit'} for m, _ in self.native.calls[before:]))

    async def test_partial_inventory_preserves_references_and_includes_all_group_history(self):
        org = await self.service.invoke('organization.get', {})
        groups = [{'room_id': 'legacy', 'read_key': 'room:legacy:1700000000.123456', 'members': [{}] * 10},
            {'room_id': 'superseded', 'read_key': 'room:superseded:1699999999.25', 'members': [{}] * 2}]
        projected = reconcile(org, self.store.read(), groups)
        saved = await self.save(projected)
        self.assertEqual(reconcile(saved, self.store.read(), []), saved)
        self.assertEqual([i['readKey'] for i in saved['sections'][0]['items'] if i['kind'] == 'group'], [r['read_key'] for r in groups])
        state = self.store.read(); state['bots']['amy']['available'] = False
        self.assertEqual(reconcile(saved, state, groups), saved)

    async def test_old_writers_and_duplicate_placements_fail_before_mutation(self):
        org = await self.service.invoke('organization.get', {})
        for value in [{**org, 'schema': 2, 'crews': []},
                {**org, 'sections': [{**org['sections'][0], 'items': org['sections'][0]['items'] * 2}]}]:
            with self.assertRaises(InvalidOperation): await self.save(value)
        with self.assertRaises(InvalidOperation): await self.service.invoke('organization.chat', {'id': 'ops', 'expected_revision': 0, 'confirm_new': False})
        self.assertEqual(await self.service.invoke('organization.get', {}), org)

    async def test_agents_create_sections_and_move_exact_rows_with_current_revisions(self):
        org = agent_edit(self.store, 'amy', 'sidebar.describe', {})
        spec = {'operation_id': str(uuid.uuid4()), 'expected_revision': org['revision'], 'name': 'Research'}
        saved = agent_edit(self.store, 'amy', 'sidebar.section.create', spec)
        self.assertEqual(agent_edit(self.store, 'amy', 'sidebar.section.create', spec), saved)
        section = saved['sections'][-1]
        row = saved['sections'][0]['items'][0]
        move = {'operation_id': str(uuid.uuid4()), 'expected_revision': saved['revision'], 'placement_id': row['placementId'], 'section_id': section['id'], 'before_id': None}
        moved = agent_edit(self.store, 'default', 'sidebar.move', move)
        self.assertEqual(moved['sections'][-1]['items'], [row])
        self.assertEqual(agent_edit(self.store, 'default', 'sidebar.move', move), moved)
        stale = {**move, 'operation_id': str(uuid.uuid4()), 'before_id': 'missing'}
        with self.assertRaises(InvalidOperation): agent_edit(self.store, 'amy', 'sidebar.move', stale)
        with self.assertRaises(InvalidOperation): agent_edit(self.store, 'foreign', 'sidebar.describe', {})
