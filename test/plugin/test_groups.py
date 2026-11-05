from copy import deepcopy
import json
import unittest
import test_workspace as fixture
from bot_web.native import NativeError
from bot_web.operations import InvalidOperation
from bot_web.workspace import WorkspaceStore, WorkspaceService
from bot_web.operations import BotOperations


class ExplicitGroupTests(unittest.IsolatedAsyncioTestCase):
    asyncTearDown = fixture.WorkspaceTests.asyncTearDown
    async def asyncSetUp(self):
        await fixture.WorkspaceTests.asyncSetUp(self)
        self.rooms = {}; self.creates = []; self.mode = 'normal'; self.fail_read = False
        previous = self.native.call
        async def native(method, params):
            if method == 'bot_web.identities': return {'identities': {'default': 'a'*64, 'amy': 'b'*64}}
            if method == 'groups.state':
                self.assertTrue(params.get('include_disbanded'))
                if self.fail_read:
                    self.fail_read = False
                    raise NativeError('Unknown network failure')
                if self.mode == 'unknown': raise NativeError('Unverified not found')
                if self.mode == 'expired': raise NativeError('Retired', reason='room_history_expired')
                room = self.rooms.get(params['room_id'])
                if room is None: raise NativeError('Missing', reason='room_not_found')
                return {'room': deepcopy(room)}
            if method == 'groups.create':
                self.creates.append(deepcopy(params))
                if self.mode != 'lost-before':
                    self.rooms[params['room_id']] = {**deepcopy(params), 'created_at': 1700000000.123456}
                if self.mode in {'lost-after', 'lost-before'}:
                    self.fail_read = True
                    raise NativeError('Lost acknowledgement')
                return {'room': self.rooms[params['room_id']]}
            if method == 'groups.list': return {'rooms': list(self.rooms.values())}
            return await previous(method, params)
        self.native.call = native
        await self.service.sync(include_model=False)
        self.params = {'room_id': 'explicit-group', 'name': 'Topic discussion', 'profiles': ['default', 'amy']}

    async def create(self): return await self.service.invoke('room.create', self.params)

    async def test_normal_creation_and_exact_retry_preserve_native_identity_and_roster(self):
        result = await self.create(); self.assertEqual(result['state'], 'ready')
        self.assertEqual(result, await self.create()); self.assertEqual(len(self.creates), 1)
        self.assertEqual(result['room']['read_key'], 'room:explicit-group:1700000000.123456')
        self.assertEqual(result['room']['members'], self.creates[0]['members'])
        snapshot = await self.service.invoke('workspace.snapshot', {})
        references = [i for s in snapshot['organization']['sections'] for i in s['items'] if i['kind'] == 'group']
        self.assertEqual(references[0]['readKey'], result['room']['read_key'])
        self.assertFalse(any(m in {'groups.send', 'prompt.submit'} for m, _ in self.native.calls))

    async def test_lost_acknowledgement_recovers_same_room_after_restart_and_name_change(self):
        self.mode = 'lost-after'
        self.assertEqual(await self.create(), {'state': 'uncertain'})
        self.native.profiles[1]['ui_meta']['hermes-bots']['title'] = 'Renamed later'
        reopened = WorkspaceStore(self.path)
        try:
            service = WorkspaceService(BotOperations(self.native), reopened)
            recovered = await service.invoke('room.create', self.params)
        finally: reopened.db.close()
        self.assertEqual(recovered['state'], 'ready'); self.assertEqual(len(self.creates), 1)
        self.assertEqual(recovered['room']['members'], self.creates[0]['members'])
        self.assertEqual(recovered['room']['members'][1]['display_name'], 'Amy')

    async def test_unknown_absence_and_expired_history_never_authorize_creation(self):
        for mode in ('unknown', 'expired'):
            self.mode = mode
            self.assertEqual(await self.create(), {'state': 'uncertain'})
        self.assertEqual(self.creates, [])
        self.mode = 'normal'
        self.assertEqual((await self.create())['state'], 'ready')

    async def test_unconfirmed_attempt_is_not_replayed_and_existing_rooms_are_never_adopted(self):
        self.mode = 'lost-before'
        self.assertEqual(await self.create(), {'state': 'uncertain'})
        self.assertEqual(await self.create(), {'state': 'uncertain'}); self.assertEqual(len(self.creates), 1)
        self.params = {**self.params, 'room_id': 'unowned'}
        self.rooms['unowned'] = {'room_id': 'unowned', 'name': 'Existing room', 'members': [], 'created_at': 1}
        self.mode = 'normal'
        with self.assertRaises(InvalidOperation): await self.create()
        self.assertEqual(len(self.creates), 1)
        self.params = {**self.params, 'room_id': 'explicit-group', 'name': 'Different name'}
        with self.assertRaises(InvalidOperation): await self.create()

    async def test_only_exact_pinned_absence_is_classified(self):
        self.assertEqual(NativeError.from_rpc({'code': 4114, 'message': 'hosted room not found'}).reason, 'room_not_found')
        for error in [{'code': 5115, 'message': 'hosted room not found'}, {'code': 4114, 'message': 'other failure'}, {'code': 4114, 'message': 'hosted room not found', 'data': {'reason': 'room_history_expired'}}]:
            self.assertNotEqual(NativeError.from_rpc(error).reason, 'room_not_found')
