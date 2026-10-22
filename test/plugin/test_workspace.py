import base64
import io
import json
from pathlib import Path
import tempfile
import unittest
from test_security import Native
from bot_web.operations import BotOperations, InvalidOperation
from bot_web.workspace import WorkspaceStore, WorkspaceService, normalize_photo
from bot_web.runtime import live_context


class WorkspaceNative(Native):
    def __init__(self):
        super().__init__()
        self.profiles = [{'name': 'default', 'is_default': True, 'ui_meta': {'hermes-bots': {'title': 'Aurora', 'foreign': {'keep': 1}}}, 'ui_meta_revisions': {'hermes-bots': 3}, 'canonical_session': {'id': 'root'}},
            {'name': 'amy', 'is_default': False, 'ui_meta': {'hermes-bots': {'title': 'Amy'}}, 'canonical_session': {'id': 'amy-root'}}]

    async def call(self, method, params):
        self.calls.append((method, params))
        if method == 'profiles.list':
            return {'bot_mode_protocol': True, 'profiles': json.loads(json.dumps(self.profiles))}
        if method == 'profiles.configure':
            row = next(r for r in self.profiles if r['name'] == params['name'])
            row['ui_meta'].update(params['ui_meta'])
            return {'applied': {'ui_meta': True, 'description': True}}
        if method == 'session.list':
            return {'sessions': [{'id': 'root', 'title': 'Bot Chat'}]}
        return {}


class WorkspaceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'workspace.sqlite'
        self.store = WorkspaceStore(self.path)
        self.native = WorkspaceNative()
        self.service = WorkspaceService(BotOperations(self.native), self.store)
        detection = await self.service.invoke('workspace.detect_primary', {})
        self.assertEqual(detection['profile'], 'default')
        self.assertEqual(detection['bot']['name'], 'Aurora')
        await self.service.invoke('workspace.initialize', {'profile': 'default', 'handle': 'aurora', 'appearance': {'kind': 'shape', 'shape': 'petal', 'color': 'white'}, 'photo': None, 'expected_revision': detection['revision']})
        # These historical fixtures intentionally model an attached agent.
        from bot_web.reporting import assign
        state = self.store.read()
        assign(state, 'amy', 'default')
        self.store.save(state, state['revision'])

    async def asyncTearDown(self):
        self.store.db.close()
        self.directory.cleanup()

    async def test_private_activity_is_only_in_explicit_own_conversation_context(self):
        from unittest.mock import patch
        from bot_web.exchanges import Exchanges
        state=self.store.read()
        for bot in state['bots'].values():
            bot['native_incarnation']='f'*64
        self.store.save(state,state['revision'])
        first, second=state['bots']['default'], state['bots']['amy']
        ledger=Exchanges(self.store)
        try:
            with ledger.db:
                ledger.db.execute('INSERT INTO exchanges VALUES(?,?)',('private-test',1))
                for bot in (first,second):
                    ledger.db.execute('INSERT INTO participants VALUES(?,?,?,?,NULL)',('private-test',bot['id'],bot['profile'],bot['native_incarnation']))
                ledger.db.execute('INSERT INTO messages(exchange,identity,text,created,key) VALUES(?,?,?,?,?)',('private-test',second['id'],'Private peer result',2,'reply-test'))
                ledger.db.execute('INSERT INTO deliveries VALUES(?,?,?,?,?,?,?,NULL,NULL,?,?,?)',('delivery-test','private-test',first['id'],second['id'],'Request','request','completed',1,'source','fingerprint'))
            by_id={bot['id']:bot for bot in state['bots'].values()}
            with patch('bot_web.exchanges.Exchanges.actor',side_effect=lambda ident:by_id[ident]):
                own=json.loads(live_context(self.store,'default',include_private=True).split('\n',1)[1])
                self.assertEqual(own['private_conversations'][0]['latest_peer_message'],'Private peer result')
                other=json.loads(live_context(self.store,'amy').split('\n',1)[1])
                self.assertNotIn('private_conversations',other)
        finally:
            ledger.close()

    async def test_turn_context_is_bounded_for_a_large_roster_with_long_instructions(self):
        from copy import deepcopy
        state=self.store.read()
        template=state['bots']['amy']
        for index in range(40):
            bot=deepcopy(template);bot.update(id=str(index),profile='agent-'+str(index),handle='agent-'+str(index))
            bot['role']['responsibilities']='Long current Instructions. '*400
            state['bots'][bot['profile']]=bot
        self.store.save(state,state['revision'])
        context=live_context(self.store,'default',compact=True)
        self.assertLess(len(context),5200)
        value=json.loads(context.split('\n',1)[1])
        self.assertEqual(value['main_pebble']['profile'],'default')
        self.assertTrue(value['directory_more'])
        self.assertIn('A clear owner request already authorizes that change',value['instructions'])

    async def test_onboarding_saves_full_role_and_reporting_before_welcome(self):
        from unittest.mock import AsyncMock
        self.native.profiles.append({'name': 'beth', 'is_default': False,
            'ui_meta': {'hermes-bots': {'title': 'Beth'}},
            'canonical_session': {'id': 'beth-root'}})
        current = await self.service.invoke('workspace.describe', {})
        amy = next(b for b in current['bots'] if b['profile'] == 'amy')
        role = {'title': 'Researcher', 'description': 'Explores questions',
                'responsibilities': 'Summarize sources', 'boundaries': 'Ask before publishing',
                'expectedOutputs': 'A research brief'}
        self.service.ops.enable_existing = AsyncMock()
        await self.service.invoke('agent.onboard', {
            'profile': 'amy', 'id': amy['id'], 'name': 'Amy', 'handle': 'amy',
            'appearance': amy['appearance'], 'photo': None, 'role': role, 'manager': 'beth',
            'expected_revision': current['revision']})
        saved = self.store.read()['bots']['amy']
        self.assertEqual(saved['manager'], 'beth')
        self.assertEqual(saved['role'], role)
        self.service.ops.enable_existing.assert_awaited_once_with('amy')
        self.assertFalse(any(method == 'prompt.submit' for method, _ in self.native.calls))
        self.assertEqual(self.native.profiles[1]['ui_meta']['hermes-bots']['workspaceRole'], role)

    async def test_onboarding_rejects_reporting_cycle_before_native_writes(self):
        from unittest.mock import AsyncMock
        current = await self.service.invoke('workspace.describe', {})
        amy = next(b for b in current['bots'] if b['profile'] == 'amy')
        self.service.ops.enable_existing = AsyncMock()
        self.native.calls.clear()
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('agent.onboard', {
                'profile': 'amy', 'id': amy['id'], 'name': 'Amy', 'handle': 'amy',
                'appearance': amy['appearance'], 'photo': None, 'role': amy['role'],
                'manager': 'amy', 'expected_revision': current['revision']})
        self.service.ops.enable_existing.assert_not_awaited()
        self.assertFalse(any(method in {'profiles.configure', 'profiles.set_asset', 'prompt.submit'}
                             for method, _ in self.native.calls))
        self.assertEqual(self.store.read()['bots']['amy']['manager'], 'default')


    async def test_owner_profile_save_keeps_identity_personality_and_unknown_metadata(self):
        state = self.store.read()
        original_id = state['bots']['default']['id']
        role = state['bots']['default']['role']
        role['boundaries'] = 'Do not change my existing responsibilities'
        self.store.save(state, state['revision'])
        state = self.store.read()
        await self.service.invoke('bots.profile.update', {
            'profile': 'default', 'id': original_id, 'name': 'aurora McKay',
            'handle': 'aurora-new', 'appearance': {'kind': 'shape', 'shape': 'cairn', 'color': 'moss'},
            'photo': None, 'role': {'title': 'Chief of staff', 'description': 'Coordinates my crew'},
            'expected_revision': state['revision']})
        current = await self.service.invoke('workspace.describe', {})
        bot = next(b for b in current['bots'] if b['profile'] == 'default')
        self.assertEqual(bot['name'], 'aurora McKay')
        self.assertEqual(bot['id'], original_id)
        self.assertEqual(bot['role']['boundaries'], role['boundaries'])
        self.assertEqual(bot['handle'], 'aurora-new')
        meta = self.native.profiles[0]['ui_meta']['hermes-bots']
        self.assertEqual(meta['foreign'], {'keep': 1})
        writes = [params for method, params in self.native.calls if method == 'profiles.configure']
        self.assertTrue(all(set(p) <= {'name', 'ui_meta', 'ui_meta_expected_revisions'} for p in writes))
        self.assertFalse(any(method == 'prompt.submit' for method, _ in self.native.calls))
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('bots.profile.update', {
                'profile': 'default', 'id': 'replaced', 'name': 'wrong', 'handle': 'aurora',
                'appearance': bot['appearance'], 'photo': None, 'role': {'title': '', 'description': ''},
                'expected_revision': current['revision']})

    async def test_intro_is_owner_requested_once_and_never_replayed_after_unknown_result(self):
        from unittest.mock import AsyncMock
        from bot_web.native import NativeError
        self.service.ops.greet = AsyncMock(side_effect=NativeError('Lost reply'))
        state = self.store.read()
        identity = state['bots']['default']['id']
        result = await self.service.invoke('agent.welcome', {'profile': 'default', 'id': identity})
        self.assertEqual(result, {'state': 'uncertain', 'submitted': False})
        result = await self.service.invoke('agent.welcome', {'profile': 'default', 'id': identity})
        self.assertFalse(result['submitted'])
        self.service.ops.greet.assert_awaited_once()
        prompt = self.service.ops.greet.call_args.args[1]
        self.assertIn('@aurora', prompt)
        self.assertIn('existing voice and personality', prompt)

    async def test_existing_agent_context_resolves_main_pebble_and_manager_to_same_identity(self):
        state = self.store.read()
        state['bots']['default']['role']['title'] = 'Chief of Staff'
        state['bots']['amy'].update(handle='chloe', manager='default')
        state['bots']['amy']['role']['title'] = "Aurora's assistant"
        self.store.save(state, state['revision'])
        context = json.loads(live_context(self.store, 'amy').split('\n', 1)[1])
        self.assertEqual(context['main_pebble']['handle'], '@aurora')
        self.assertEqual(context['main_pebble']['profile'], 'default')
        self.assertEqual(context['your_manager'], context['main_pebble'])
        self.assertEqual([p['handle'] for p in context['your_reporting_path']], ['@chloe', '@aurora'])
        self.assertIn('@aurora is the Main Pebble', context['hierarchy_summary'])
        self.assertIn('human owner', context['hierarchy_summary'])
        root = next(p for p in context['directory'] if p['handle'] == '@aurora')
        self.assertTrue(root['is_main_pebble'])
        self.assertIsNone(root['manager'])
        self.assertEqual(root['profile'], 'default')
        self.assertEqual(root['native_target'], 'hermes')

    async def test_main_pebble_has_no_pebble_manager_and_transfer_refreshes_context(self):
        context = json.loads(live_context(self.store, 'default').split('\n', 1)[1])
        self.assertTrue(context['is_main_pebble'])
        self.assertIsNone(context['your_manager'])
        self.assertIn('You are @aurora, the Main Pebble', context['hierarchy_summary'])
        state = self.store.read()
        await self.service.invoke('workspace.set_orchestrator', {
            'profile': 'amy', 'expected_revision': state['revision']})
        context = json.loads(live_context(self.store, 'default').split('\n', 1)[1])
        self.assertFalse(context['is_main_pebble'])
        self.assertEqual(context['main_pebble']['handle'], '@amy')
        self.assertIsNone(context['your_manager'])

    async def test_indirect_manager_is_distinct_from_the_main_pebble(self):
        self.native.profiles.append({'name': 'grace', 'is_default': False,
            'ui_meta': {'hermes-bots': {'title': 'Grace'}},
            'canonical_session': {'id': 'grace-root'}})
        await self.service.invoke('workspace.describe', {})
        state = self.store.read()
        state['bots']['default']['role']['title'] = 'Chief of Staff'
        state['bots']['grace']['role']['title'] = 'Executive Assistant'
        state['bots']['amy'].update(handle='chloe', manager='grace', manager_id=state['bots']['grace']['id'])
        state['bots']['grace'].update(manager='default', manager_id=state['bots']['default']['id'])
        self.store.save(state, state['revision'])
        context = json.loads(live_context(self.store, 'amy').split('\n', 1)[1])
        self.assertEqual(context['main_pebble']['handle'], '@aurora')
        self.assertEqual(context['your_manager']['handle'], '@grace')
        self.assertEqual([p['handle'] for p in context['your_reporting_path']], ['@chloe', '@grace', '@aurora'])
        self.assertIn('@chloe -> @grace -> @aurora (Main Pebble) -> human owner', context['hierarchy_summary'])

    async def test_existing_agent_intro_names_main_pebble_and_exact_reporting_path(self):
        from unittest.mock import AsyncMock
        self.service.ops.greet = AsyncMock()
        state = self.store.read()
        state['bots']['amy']['handle'] = 'chloe'
        self.store.save(state, state['revision'])
        await self.service.invoke('agent.welcome', {'profile': 'amy', 'id': state['bots']['amy']['id']})
        prompt = self.service.ops.greet.call_args.args[1]
        self.assertIn('@aurora is the Main Pebble', prompt)
        self.assertIn('@chloe -> @aurora (Main Pebble) -> human owner', prompt)

    async def test_no_configured_main_pebble_does_not_infer_one_from_a_job_title(self):
        state = self.store.read()
        state.update(initialized=False, orchestrator=None)
        state['bots']['default']['role']['title'] = 'Main Pebble'
        self.store.save(state, state['revision'])
        context = json.loads(live_context(self.store, 'amy').split('\n', 1)[1])
        self.assertIsNone(context['main_pebble'])
        self.assertFalse(context['is_main_pebble'])
        self.assertIn('not configured', context['hierarchy_summary'])

    async def test_stock_native_photo_does_not_override_animated_default_or_saved_choice(self):
        self.native.profiles[1]['has_avatar'] = True
        state = self.store.read()
        state['bots']['amy']['appearance'] = {'kind': 'photo', 'shape': 'pebble', 'color': 'citron'}
        self.store.save(state, state['revision'])
        current = await self.service.invoke('workspace.describe', {})
        amy = next(b for b in current['bots'] if b['profile'] == 'amy')
        self.assertEqual(amy['appearance'], {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'})
        self.native.profiles[1]['ui_meta']['hermes-bots']['workspaceAppearance'] = {'kind': 'photo', 'shape': 'seed', 'color': 'umber'}
        state = self.store.read()
        state['bots']['amy']['appearance'] = {'kind': 'photo', 'shape': 'seed', 'color': 'umber'}
        self.store.save(state, state['revision'])
        current = await self.service.invoke('workspace.describe', {})
        self.assertEqual(next(b for b in current['bots'] if b['profile'] == 'amy')['appearance']['kind'], 'photo')

    async def test_durable_identity_and_metadata_merge_preserve_unknown_native_fields(self):
        state = self.store.read()
        self.assertEqual(self.native.profiles[0]['ui_meta']['hermes-bots']['foreign'], {'keep': 1})
        await self.service.invoke('bots.update_handle', {'profile': 'default', 'handle': 'lead', 'expected_revision': state['revision']})
        reopened = WorkspaceStore(self.path)
        self.assertEqual(reopened.read()['bots']['default']['id'], state['bots']['default']['id'])
        self.assertEqual(reopened.read()['aliases']['aurora'], 'default')
        reopened.db.close()
        self.assertFalse(any(method == 'prompt.submit' for method, _ in self.native.calls))

    async def test_stale_revision_and_native_identity_collisions_are_rejected(self):
        state = self.store.read()
        for handle in ('amy', 'admin', 'bad handle'):
            with self.assertRaises(InvalidOperation):
                await self.service.invoke('bots.update_handle', {'profile': 'default', 'handle': handle, 'expected_revision': state['revision']})
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('bots.update_handle', {'profile': 'default', 'handle': 'safe', 'expected_revision': -1})

    async def test_extended_appearance_catalogue_survives_restart_without_changing_identity(self):
        original = self.store.read()['bots']['default']
        for shape, color in zip(('cairn', 'seed', 'dune', 'flint', 'drift'),
                                ('umber', 'moss', 'ocean', 'heather', 'sienna')):
            state = self.store.read()
            look = {'kind': 'shape', 'shape': shape, 'color': color}
            await self.service.invoke('bots.appearance.update', {
                'profile': 'default', 'appearance': look, 'photo': None,
                'expected_revision': state['revision']})
            reopened = WorkspaceStore(self.path)
            saved = reopened.read()['bots']['default']
            self.assertEqual(saved['appearance'], look)
            self.assertEqual(saved['id'], original['id'])
            self.assertEqual(saved['handle'], original['handle'])
            self.assertEqual(saved['role'], original['role'])
            reopened.db.close()
        self.assertFalse(any(method == 'prompt.submit' for method, _ in self.native.calls))

    async def test_reporting_cycle_is_rejected_and_teams_do_not_grant_permissions(self):
        state = self.store.read()
        role = state['bots']['amy']['role']
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('roles.update', {'profile': 'amy', 'role': role, 'manager': 'amy', 'team': None, 'expected_revision': state['revision']})
        saved = await self.service.invoke('teams.save', {'teams': [{'id': 'team-1', 'name': 'Research'}], 'expected_revision': state['revision']})
        self.assertNotIn('grants', saved)
        self.assertEqual(saved['orchestrator'], 'default')

    async def test_model_proposal_cannot_execute_and_approval_binds_exact_spec(self):
        request_id, status = self.store.request('amy', 'agent.enable', {'profile': 'amy', 'initialize_chat': True})
        self.assertEqual(status, 'pending')
        request = self.store.requests()[0]
        before = len(self.native.calls)
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('requests.approve', {'id': request_id, 'fingerprint': 'wrong'})
        self.assertTrue(all(method in {'profiles.list', 'bot_web.models', 'bot_web.identities'} for method, _ in self.native.calls[before:]))
        denied = await self.service.invoke('requests.deny', {'id': request_id, 'fingerprint': request['fingerprint']})
        self.assertEqual(denied['state'], 'denied')
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('requests.approve', {'id': request_id, 'fingerprint': request['fingerprint']})

    async def test_incomplete_creation_is_not_enrolled_by_native_metadata_on_refresh(self):
        spec = {'name': 'incomplete', 'role': 'Job'}
        request_id, _ = self.store.request('owner', 'agent.create', spec)
        with self.store.db:
            self.store.db.execute("UPDATE requests SET state='partial',result=? WHERE id=?", (json.dumps({'profile': 'incomplete'}), request_id))
        self.native.profiles.append({'name': 'incomplete', 'ui_meta': {'hermes-bots': {'title': 'Incomplete', 'workspaceRole': {key: '' for key in ('title','description','responsibilities','boundaries','expectedOutputs')}}}})
        for _ in range(2):
            snapshot = await self.service.invoke('workspace.describe', {})
            bot = next(bot for bot in snapshot['bots'] if bot['profile'] == 'incomplete')
            self.assertFalse(bot['enrolled'])
        self.assertEqual(self.store.incomplete_creations(), {'incomplete'})
        # Explicit reviewed enrollment is recovery, not an automatic creation replay.
        from unittest.mock import AsyncMock
        self.service.ops.enable_existing = AsyncMock(return_value={'profile': 'incomplete', 'session_id': 'repaired-chat'})
        await self.service.invoke('agent.enable', {'profile': 'incomplete', 'initialize_chat': True})
        self.assertEqual(self.store.incomplete_creations(), set())
        self.assertEqual(self.store.requests()[0]['state'], 'superseded')
        self.assertEqual(self.store.requests()[0]['result']['resolution'], 'owner_enabled_existing_profile')
        next_snapshot = await self.service.invoke('workspace.describe', {})
        self.assertTrue(next(bot for bot in next_snapshot['bots'] if bot['profile'] == 'incomplete')['enrolled'])
        self.assertFalse(any(method == 'profiles.create' for method, _ in self.native.calls))


    def test_photo_decoder_rejects_active_and_oversized_content(self):
        for value in ('https://example.test/photo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YmFk'):
            with self.assertRaises(InvalidOperation):
                normalize_photo(value)

    def test_photo_reencoded_as_metadata_free_bounded_raster(self):
        from PIL import Image, PngImagePlugin
        source = io.BytesIO()
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text('private', 'synthetic GPS/filename marker')
        Image.new('RGB', (64, 32), 'red').save(source, format='PNG', pnginfo=metadata)
        normalized = normalize_photo('data:image/png;base64,' + base64.b64encode(source.getvalue()).decode())
        with Image.open(io.BytesIO(base64.b64decode(normalized.split(',')[1]))) as image:
            self.assertEqual(image.size, (512, 512))
            self.assertEqual(image.info, {})
