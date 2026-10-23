import unittest
from test_workspace import WorkspaceTests
from bot_web.operations import InvalidOperation
from bot_web.native import NativeError


class PresentationTests(WorkspaceTests):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.stamps = {'default': 'a'*64, 'amy': 'b'*64}
        call = self.native.call
        self.deleted = 0
        self.delete_result = {'state': 'completed', 'files_deleted': True}
        async def native(method, params):
            if method == 'bot_web.identities':
                return {'identities': self.stamps}
            if method == 'bot_web.lifecycle':
                self.deleted += 1
                if isinstance(self.delete_result, Exception):
                    raise self.delete_result
                if self.delete_result.get('files_deleted'):
                    self.native.profiles = [r for r in self.native.profiles if r['name'] != params['profile']]
                    self.stamps.pop(params['profile'])
                return self.delete_result
            if method == 'groups.list':
                return {'rooms': []}
            return await call(method, params)
        self.native.call = native
        await self.service.invoke('workspace.snapshot', {})

    async def test_created_group_is_in_the_immediate_authenticated_snapshot(self):
        import httpx
        from unittest.mock import patch
        from bot_web.server import create_app
        from test_security import TOKEN, ORIGIN, HOST
        rooms = []
        call = self.native.call
        async def native(method, params):
            if method == 'groups.list': return {'rooms': list(rooms)}
            if method == 'groups.create':
                room = {**params, 'created_at': 1}
                rooms.append(room)
                return room
            return await call(method, params)
        self.native.call = native
        self.service._snapshot = None
        with patch('bot_web.presentation.time.monotonic', return_value=100):
            await self.service.invoke('workspace.snapshot', {})
            app = create_app(TOKEN, {ORIGIN}, {HOST}, self.native, workspace=self.service)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://'+HOST) as client:
                headers = {'Origin': ORIGIN, 'Authorization': 'Bearer '+TOKEN}
                connected = await client.post('/v1/connect', headers=headers)
                headers['X-Bot-Connection'] = connected.json()['connection']
                created = await client.post('/v1/rpc', headers=headers, json={'operation':'room.create','params':{'room_id':'new-discussion','name':'New discussion','profiles':['default','amy']}})
                self.assertEqual(created.status_code, 200, created.text)
                snapshot = await client.post('/v1/rpc', headers=headers, json={'operation':'workspace.snapshot','params':{}})
                self.assertEqual(snapshot.status_code, 200, snapshot.text)
                self.assertEqual([r['room_id'] for r in snapshot.json()['result']['rooms']], ['new-discussion'])

    def spec(self, profile='amy'):
        state = self.store.read()
        return {'profile': profile, 'id': state['bots'][profile]['id'], 'expected_revision': state['revision']}

    async def approve_delete(self):
        spec = self.spec()
        request_id, _ = self.store.request('default', 'agent.delete', spec)
        request = next(r for r in self.store.requests() if r['id'] == request_id)
        return await self.service.invoke('requests.approve', {'id': request_id, 'fingerprint': request['fingerprint'], 'confirmation': 'amy'})

    async def test_external_hide_removes_roster_but_retains_identity_and_unhide(self):
        original = self.spec()['id']
        self.native.profiles[1]['ui_meta']['hermes-bots']['hidden'] = True
        self.service._snapshot = None
        snapshot = await self.service.invoke('workspace.snapshot', {})
        self.assertEqual([b['profile'] for b in snapshot['bots']], ['default'])
        self.assertTrue(snapshot['workspace']['bots'][1]['hidden'])
        await self.service.invoke('agent.hide', {**self.spec(), 'hidden': False})
        self.assertEqual(self.spec()['id'], original)
        self.assertEqual(len(await self.service.ops.roster()), 2)

    async def test_recreated_name_cannot_inherit_handle_approval_or_pin_order(self):
        old = self.spec()
        await self.service.invoke('bots.update_handle', {'profile': 'amy', 'handle': 'researcher', 'expected_revision': old['expected_revision']})
        old = self.spec()
        self.stamps['amy'] = 'c'*64
        self.service._snapshot = None
        await self.service.invoke('workspace.snapshot', {})
        self.assertNotEqual(self.spec()['id'], old['id'])
        self.assertNotEqual(self.store.read()['aliases']['researcher'], 'amy')
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('agent.hide', {**old, 'hidden': True})
        self.assertEqual(self.deleted, 0)

    async def test_unchanged_default_handle_is_reserved_after_recreation(self):
        self.assertEqual(self.store.read()['bots']['amy']['handle'], 'amy')
        self.stamps['amy'] = 'd'*64
        self.service._snapshot = None
        await self.service.invoke('workspace.snapshot', {})
        self.assertNotEqual(self.store.read()['bots']['amy']['handle'], 'amy')
        self.assertTrue(self.store.read()['aliases']['amy'].startswith('!retired:'))

    async def test_proven_native_rename_preserves_identity_and_reporting(self):
        old = self.spec()['id']
        self.native.profiles[1]['name'] = 'research'
        # Even older native rosters without previous_names prove the rename
        # through the moved directory's private incarnation witness.
        self.stamps['research'] = self.stamps.pop('amy')
        self.service._snapshot = None
        await self.service.invoke('workspace.snapshot', {})
        self.assertEqual(self.spec('research')['id'], old)
        self.assertNotIn('amy', self.store.read()['bots'])

    async def test_read_cursors_are_monotonic_scoped_and_do_not_query_model(self):
        self.native.profiles[1]['canonical_session'].update(message_count=3)
        self.service._snapshot = None
        snap = await self.service.invoke('workspace.snapshot', {})
        bot = snap['workspace']['bots'][1]
        self.native.profiles[1]['canonical_session']['message_count'] = 5
        self.service._snapshot = None
        snap = await self.service.invoke('workspace.snapshot', {})
        self.assertTrue(snap['workspace']['bots'][1]['unread'])
        before = len(self.native.calls)
        await self.service.invoke('presentation.read', {'key': bot['read_key'], 'cursor': 5})
        await self.service.invoke('presentation.read', {'key': bot['read_key'], 'cursor': 3})
        self.assertEqual(self.store.db.execute('SELECT cursor FROM read_cursors WHERE key=?', (bot['read_key'],)).fetchone()[0], 5)
        snap = await self.service.invoke('workspace.snapshot', {})
        self.assertFalse(snap['workspace']['bots'][1]['unread'])
        self.native.profiles[1]['canonical_session']['message_count'] = 6
        self.service._snapshot = None
        await self.service.invoke('presentation.read', {'key': bot['read_key'], 'cursor': 5})
        snap = await self.service.invoke('workspace.snapshot', {})
        self.assertTrue(snap['workspace']['bots'][1]['unread'])
        self.assertFalse(any(m == 'bot_web.models' for m, _ in self.native.calls[before:]))
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('presentation.read', {'key': bot['read_key'], 'cursor': 999})

    async def test_delete_requires_exact_confirmation_and_never_replays(self):
        spec = self.spec()
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('agent.delete', spec)
        request_id, _ = self.store.request('default', 'agent.delete', spec)
        request = self.store.requests()[0]
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('requests.approve', {'id': request_id, 'fingerprint': request['fingerprint'], 'confirmation': 'wrong'})
        self.assertEqual(self.store.requests()[0]['state'], 'pending')
        result = await self.approve_delete()
        self.assertEqual(result['state'], 'completed')
        self.assertEqual(self.deleted, 1)
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('requests.approve', {'id': request_id, 'fingerprint': request['fingerprint'], 'confirmation': 'amy'})
        self.assertEqual(self.deleted, 1)

    async def test_uncertain_delete_is_inspected_without_resubmitting(self):
        self.delete_result = NativeError('test timeout')
        result = await self.approve_delete()
        self.assertEqual(result['state'], 'uncertain')
        request = self.store.requests()[0]
        checked = await self.service.invoke('requests.reconcile', {'id': request['id']})
        self.assertTrue(checked['target_present'])
        self.assertEqual(self.deleted, 1)

    async def test_delete_protects_the_catalog_in_its_own_workspace(self):
        from pathlib import Path
        import tempfile
        from unittest.mock import patch
        from bot_web.work_store import WorkStore

        state = self.store.read()
        catalog = WorkStore(self.path.with_name('work.sqlite'))
        try:
            catalog.catalog({**state, 'orchestrator': 'amy'})
        finally:
            catalog.close()
        with tempfile.TemporaryDirectory() as unrelated:
            with patch('bot_web.workspace.workspace_path', return_value=Path(unrelated) / 'workspace.sqlite'):
                result = await self.approve_delete()
        self.assertEqual(result['state'], 'failed')
        self.assertIn('project catalog', result['result']['error'])
        self.assertEqual(self.deleted, 0)
        self.assertTrue(any(row['name'] == 'amy' for row in self.native.profiles))

    async def test_partial_deletion_preserves_receipt_and_retired_identity(self):
        self.delete_result = {'state': 'partial', 'files_deleted': True, 'identity_pending': True}
        result = await self.approve_delete()
        self.assertEqual(result['state'], 'partial')
        request = self.store.requests()[0]
        checked = await self.service.invoke('requests.reconcile', {'id': request['id']})
        self.assertFalse(checked['target_present'])
        self.assertEqual(self.deleted, 1)

    async def test_default_and_manager_are_protected(self):
        root = self.spec('default')
        self.service._approved_delete = root['id']
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('agent.delete', root)
        state = self.store.read()
        state['bots']['default']['manager'] = 'amy'
        self.store.save(state, state['revision'])
        self.service._approved_delete = self.spec()['id']
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('agent.delete', self.spec())
        self.assertEqual(self.deleted, 0)

    async def test_pin_order_cas_rejects_stale_and_untyped_ids(self):
        identity = self.spec()['id']
        await self.service.invoke('presentation.order', {'ids': [identity], 'expected_revision': 0})
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('presentation.order', {'ids': [], 'expected_revision': 0})
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('presentation.order', {'ids': [{}], 'expected_revision': 1})

    async def test_live_crew_membership_blocks_deletion_without_mutation(self):
        call = self.native.call
        async def native(method, params):
            if method == 'groups.list':
                return {'rooms': [{'room_id': 'live-crew', 'members': [{'profile': 'amy'}]}]}
            return await call(method, params)
        self.native.call = native
        result = await self.approve_delete()
        self.assertEqual(result['state'], 'pending')
        self.assertIn('live crew', result['result']['reason'])
        self.assertEqual(self.deleted, 0)


class IncarnationTests(unittest.TestCase):
    def test_restart_rename_clone_and_reused_name(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        import shutil
        from bot_web.lifecycle_native import incarnation
        with TemporaryDirectory() as root:
            profile = Path(root) / 'original'
            profile.mkdir()
            identity = incarnation(profile)
            self.assertEqual(identity, incarnation(profile))
            renamed = profile.rename(Path(root) / 'renamed')
            self.assertEqual(identity, incarnation(renamed))
            clone = Path(root) / 'cloned'
            shutil.copytree(renamed, clone)
            self.assertNotEqual(identity, incarnation(clone))
            shutil.rmtree(renamed)
            renamed.mkdir()
            self.assertNotEqual(identity, incarnation(renamed))

    def test_symlink_identity_is_rejected(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from bot_web.lifecycle_native import incarnation
        with TemporaryDirectory() as root:
            path = Path(root)
            target = path / 'outside'
            target.write_text('private')
            profile = path / 'profile'
            profile.mkdir()
            (profile / '.pebble-crew-identity').symlink_to(target)
            with self.assertRaises(OSError):
                incarnation(profile)
            self.assertEqual(target.read_text(), 'private')
