import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from bot_web.native import NativeGateway
from bot_web.operations import InvalidOperation
from bot_web.workspace import WorkspaceStore
from bot_web.request_delivery import deliver, deliver_native, recover


class RequestChronologyTests(unittest.TestCase):
    def test_creation_time_survives_decision_and_reopening_with_deterministic_same_time_order(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'workspace.sqlite'
            store = WorkspaceStore(path)
            with patch('bot_web.workspace.time.time', return_value=1700000000.125):
                first, _ = store.request('owner', 'agent.attach', {'profile': 'one'})
                second, _ = store.request('owner', 'agent.attach', {'profile': 'two'})
            with store.db:
                store.db.execute("UPDATE requests SET state='completed' WHERE id=?", (first,))
            store.db.close()
            reopened = WorkspaceStore(path)
            try:
                rows = reopened.requests()
                self.assertEqual([row['id'] for row in rows], [second, first])
                self.assertEqual(rows[1]['state'], 'completed')
                self.assertEqual(rows[1]['created'], 1700000000.125)
            finally:
                reopened.db.close()


class NativeQuestionTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_question_is_session_bound_and_only_calls_the_typed_lock_method(self):
        native = NativeGateway()
        native.call = AsyncMock(return_value={'status': 'ok', 'remaining': []})
        await native._server_request({'id': 'question-1', 'method': 'clarify', 'params': {
            'session_id': 'chat-1', 'questions': [{'qid': 'q0', 'question': 'Which project?',
                'choices': ['Website', 'Research'], 'multi_select': True}]}})
        self.assertEqual(await native.question_prompt('questions.pending', {'session_id': 'other'}), {'requests': []})
        with self.assertRaises(InvalidOperation):
            await native.question_prompt('questions.respond', {'session_id': 'other', 'id': 'question-1', 'question_id': 'q0', 'answer': 'Website'})
        native.call.assert_not_awaited()
        result = await native.question_prompt('questions.respond', {'session_id': 'chat-1', 'id': 'question-1', 'question_id': 'q0', 'answer': ['Website', 'Research']})
        self.assertEqual(result, {'state': 'answered'})
        method, payload = native.call.call_args.args
        self.assertEqual(method, 'clarify.lock')
        self.assertEqual(json.loads(payload['answer']), ['Website', 'Research'])
        with self.assertRaises(InvalidOperation):
            await native.question_prompt('questions.respond', {'session_id': 'chat-1', 'id': 'question-1', 'question_id': 'q0', 'answer': 'Replay'})

    async def test_partial_answers_remain_pending_and_expired_questions_are_removed(self):
        native = NativeGateway()
        native.call = AsyncMock(side_effect=[{'status': 'ok', 'remaining': ['q1']}, {'status': 'expired'}])
        await native._server_request({'id': 'questions', 'method': 'clarify', 'params': {
            'session_id': 'chat', 'questions': [{'qid': name, 'question': name, 'choices': None} for name in ['q0', 'q1']]}})
        await native.question_prompt('questions.respond', {'session_id': 'chat', 'id': 'questions', 'question_id': 'q0', 'answer': 'First answer'})
        pending = await native.question_prompt('questions.pending', {'session_id': 'chat'})
        self.assertEqual(pending['requests'][0]['answers'], {'q0': 'First answer'})
        result = await native.question_prompt('questions.respond', {'session_id': 'chat', 'id': 'questions', 'question_id': 'q1', 'answer': None})
        self.assertEqual(result, {'state': 'expired'})
        self.assertEqual(native.questions, {})


class RequestNotificationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.store = WorkspaceStore(Path(self.folder.name) / 'workspace.sqlite')
        state = self.store.read()
        state.update({'initialized': True, 'orchestrator': 'aurora', 'bots': {
            name: {'id': name+'-identity', 'profile': name, 'handle': name, 'enrolled': True,
                'role': {}, 'available': True} for name in ['aurora', 'mica', 'rowan']}})
        self.store.save(state, state['revision'])
        self.ops = SimpleNamespace(greet=AsyncMock())
        self.service = SimpleNamespace(store=self.store, ops=self.ops, lock=asyncio.Lock())

    async def asyncTearDown(self):
        self.store.db.close()
        self.folder.cleanup()

    async def test_new_agent_request_notifies_the_current_main_once_without_exposing_spec(self):
        request = self.store.request('mica', 'agent.attach', {'profile': 'mica', 'soul': 'private persona'})
        state = self.store.read(); state['orchestrator'] = 'rowan'; self.store.save(state, state['revision'])
        await deliver(self.service); await deliver(self.service)
        self.ops.greet.assert_awaited_once()
        args = self.ops.greet.call_args
        self.assertEqual(args.args[0], 'rowan')
        self.assertIn('@mica', args.args[1])
        self.assertIn(request[0], args.args[1])
        self.assertNotIn('private persona', args.args[1])
        self.assertTrue(args.kwargs['queued'])

    async def test_resolved_or_recreated_requesters_cannot_send_a_stale_notification(self):
        self.store.request('mica', 'agent.attach', {'profile': 'mica'})
        state = self.store.read(); state['bots']['mica']['id'] = 'replacement'; self.store.save(state, state['revision'])
        await deliver(self.service)
        self.ops.greet.assert_not_awaited()
        self.store.request('rowan', 'agent.attach', {'profile': 'rowan'})
        with self.store.db: self.store.db.execute("UPDATE requests SET state='denied'")
        await deliver(self.service)
        self.ops.greet.assert_not_awaited()

    async def test_uncertain_delivery_is_not_replayed_after_restart(self):
        self.store.request('mica', 'agent.attach', {'profile': 'mica'})
        self.ops.greet.side_effect = RuntimeError('Response lost')
        with self.assertRaises(RuntimeError): await deliver(self.service)
        recover(self.store)
        await deliver(self.service)
        self.ops.greet.assert_awaited_once()
        self.assertEqual(self.store.db.execute('SELECT state FROM request_notifications').fetchone()[0], 'uncertain')

    async def test_native_tool_approval_notifies_main_once_and_discards_resolved_notices(self):
        self.ops.sessions = {'session-mica': 'mica'}
        self.ops.invoke = AsyncMock(return_value={'approvals': [{'request_id': 'approval-one'}]})
        native = SimpleNamespace(approval_notices={'native-one': {'session_id': 'session-mica', 'request_id': 'approval-one'}})
        await deliver_native(self.service, native); await deliver_native(self.service, native)
        self.ops.greet.assert_awaited_once()
        self.assertEqual(self.ops.greet.call_args.args[0], 'aurora')
        self.assertIn('@mica', self.ops.greet.call_args.args[1])
        self.ops.invoke.return_value = {'approvals': []}
        await deliver_native(self.service, native)
        self.assertEqual(native.approval_notices, {})
        self.assertEqual(self.store.db.execute('SELECT state FROM native_approval_notifications').fetchone()[0], 'resolved')
