import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from test_security import Native
from bot_web.operations import BotOperations, InvalidOperation
from bot_web.spoken_turns import SpokenTurns
from bot_web.workspace import WorkspaceStore


class SpokenTurnsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.store = WorkspaceStore(Path(temp.name) / 'workspace.sqlite')
        self.addCleanup(self.store.db.close)
        self.native = Native()
        self.ops = BotOperations(self.native)
        self.ops.sessions['live-alpha'] = 'alpha'
        self.ops.session_incarnations['live-alpha'] = 'a' * 64
        self.ops.session_conversations['live-alpha'] = 'root-alpha'
        self.turns = SpokenTurns(self.ops, self.store)
        self.addAsyncCleanup(self.turns.close)
        self.call = self.turns.begin('live-alpha', 'chosen_voice')
        self.request = {'session_id': 'live-alpha', 'call_id': self.call, 'utterance_id': 'turn-1'}
        self.params = {**self.request, 'text': 'Check the report.'}

    async def test_duplicate_and_mismatched_completion_never_reach_synthesis(self):
        original = self.native.call

        async def invoke(method, params):
            if method == 'prompt.submit':
                self.native.calls.append((method, params))
                self.assertEqual(params['text'], 'Check the report.')
                self.assertEqual(params['surface'], 'voice-live')
                self.assertNotIn('voice_turn', params)
                for queue in self.native.listeners:
                    for user, assistant in ((9, 11), (10, 12)):
                        queue.put_nowait({'type': 'message.complete', 'session_id': 'live-alpha', 'payload': {
                            'status': 'complete', 'persisted_turn': {'user_row_id': user, 'final_assistant_row_id': assistant}}})
                return {'status': 'streaming', 'user_row_id': 10}
            if method == 'bot_web.conversation.history':
                return {'messages': [
                    {'role': 'assistant', 'row_id': 11, 'text': 'Other turn.'},
                    {'role': 'assistant', 'row_id': 12, 'text': 'Aurora’s exact reply.'},
                    {'role': 'assistant', 'row_id': 13, 'text': 'Newest unrelated reply.'},
                ]}
            return await original(method, params)

        self.native.call = invoke
        self.assertEqual((await self.turns.submit('live-alpha', self.params))['state'], 'pending')
        self.assertEqual((await self.turns.submit('live-alpha', self.params))['state'], 'pending')
        await asyncio.gather(*self.turns.tasks)
        self.assertEqual(self.turns.status(self.call, 'turn-1'),
                         {'state': 'ready', 'user_row_id': 10, 'assistant_row_id': 12})
        # Captions use the exact matched reply, not the newest one.
        self.assertEqual(await self.turns.reply_text('live-alpha', 12), 'Aurora’s exact reply.')
        self.assertIsNone(await self.turns.reply_text('live-alpha', 99))
        self.assertEqual(await self.turns.speech('live-alpha', self.request),
                         ('chosen_voice', 'Aurora’s exact reply.'))
        with self.assertRaises(InvalidOperation):
            await self.turns.speech('live-alpha', self.request)
        with self.assertRaises(InvalidOperation):
            await self.turns.submit('live-alpha', {**self.params, 'text': 'Changed transcript'})
        self.assertEqual([method for method, _ in self.native.calls].count('prompt.submit'), 1)

    async def test_call_turns_stay_out_of_chat_history(self):
        original = self.native.call
        release = asyncio.Event()

        async def invoke(method, params):
            if method == 'prompt.submit':
                async def complete():
                    await release.wait()
                    for queue in self.native.listeners:
                        queue.put_nowait({'type': 'message.complete', 'session_id': 'live-alpha', 'payload': {
                            'status': 'complete', 'persisted_turn': {'user_row_id': 10, 'final_assistant_row_id': 13}}})
                asyncio.get_running_loop().create_task(complete())
                return {'status': 'streaming', 'user_row_id': 10}
            return await original(method, params)

        self.native.call = invoke
        rows = [{'role': 'assistant', 'row_id': 9, 'text': 'Before the call.', 'timestamp': 1},
                {'role': 'user', 'row_id': 10, 'text': 'Check the report.', 'timestamp': 2},
                {'role': 'tool', 'row_id': 11, 'text': '{}', 'timestamp': 3},
                {'role': 'assistant', 'row_id': 12, 'text': 'Working on it.', 'timestamp': 4}]
        await self.turns.submit('live-alpha', self.params)
        await asyncio.sleep(0)
        # While the turn runs, everything from the spoken request on is call content.
        self.assertEqual(self.turns.hide_spoken_rows('live-alpha', rows), [
            rows[0], {'role': 'system', 'row_id': 10, 'timestamp': 2},
            {'role': 'system', 'row_id': 11, 'timestamp': 3}, {'role': 'system', 'row_id': 12, 'timestamp': 4}])
        release.set()
        await asyncio.gather(*self.turns.tasks)
        later = rows + [{'role': 'assistant', 'row_id': 13, 'text': 'Done.', 'timestamp': 5},
                        {'role': 'assistant', 'row_id': 14, 'text': 'Nice talking to you.', 'timestamp': 6}]
        shown = self.turns.hide_spoken_rows('live-alpha', later)
        self.assertEqual([row.get('text') for row in shown], ['Before the call.', None, None, None, None,
                                                              'Nice talking to you.'])
        # The record outlives the call, and another conversation is unaffected.
        self.turns.end('live-alpha', self.call)
        self.assertEqual(self.turns.hide_spoken_rows('live-alpha', later), shown)
        self.ops.session_conversations['live-alpha'] = 'root-beta'
        self.assertEqual(self.turns.hide_spoken_rows('live-alpha', later), later)

    async def test_queued_receipt_never_claims_some_other_response(self):
        async def invoke(*_):
            return {'status': 'queued'}
        self.native.call = invoke
        await self.turns.submit('live-alpha', self.params)
        await asyncio.gather(*self.turns.tasks)
        self.assertEqual(self.turns.status(self.call, 'turn-1')['state'], 'queued')
        with self.assertRaises(InvalidOperation):
            await self.turns.speech('live-alpha', self.request)
