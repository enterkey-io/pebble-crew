from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

from bot_web.reactions import ReactionDisplay


class ReactionDisplayTests(unittest.TestCase):
    def setUp(self):
        filters = SimpleNamespace(
            is_intentional_silence_response=lambda text: text == 'NO_REPLY',
            is_partial_silence_marker=lambda text: isinstance(text, str) and bool(text) and 'NO_REPLY'.startswith(text))
        self.modules = patch.dict(sys.modules, {'gateway.response_filters': filters})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.display = ReactionDisplay()

    def event(self, kind, text='', sid='chat', **extra):
        return self.display.event({'type': kind, 'session_id': sid, 'payload': {'text': text, **extra}})

    def test_reaction_only_marker_never_flashes_and_normal_prose_is_preserved(self):
        self.event('message.start')
        self.assertIsNone(self.event('message.delta', 'NO_'))
        self.assertIsNone(self.event('message.delta', 'REPLY'))
        self.assertEqual(self.event('message.complete', 'NO_REPLY')['payload']['text'], '')
        self.assertEqual(self.display.prefixes, {})

        self.event('message.start')
        self.assertIsNone(self.event('message.delta', 'NO_'))
        self.assertEqual(self.event('message.delta', 'REPLY is a marker')['payload']['text'], 'NO_REPLY is a marker')
        self.assertEqual(self.event('message.delta', ', not a reply.')['payload']['text'], ', not a reply.')

    def test_read_only_snapshot_filters_silence_without_changing_raw_stream_length(self):
        result = self.display.result('bot_web.conversation.snapshot', {
            'messages': [{'row_id': 1, 'role': 'assistant', 'text': 'NO_REPLY'}],
            'inflight': {'assistant': 'NO_REPLY'}, 'stream_length': 8})
        self.assertEqual(result['messages'][0]['text'], '')
        self.assertEqual(result['inflight']['assistant'], '')
        self.assertEqual(result['stream_length'], 8)

    def test_tool_segments_restart_detection_and_sessions_do_not_share_prefixes(self):
        self.event('message.start')
        self.assertEqual(self.event('message.delta', 'Here is the answer')['payload']['text'], 'Here is the answer')
        self.event('tool.start')
        self.assertIsNone(self.event('message.delta', 'NO_'))
        self.event('message.start', sid='other')
        self.assertEqual(self.event('message.delta', 'Another reply', sid='other')['payload']['text'], 'Another reply')
        self.assertIsNone(self.event('message.delta', 'REPLY'))
        self.assertEqual(self.event('message.complete', 'NO_REPLY')['payload']['text'], '')

    def test_history_and_replay_preserve_native_rows_and_error_details(self):
        source = {'messages': [
            {'role': 'user', 'row_id': 1, 'text': 'NO_REPLY'},
            {'role': 'assistant', 'row_id': 2, 'text': 'NO_REPLY', 'codex_message_items': 'saved native marker'},
            {'role': 'assistant', 'row_id': 3, 'text': 'NO_REPLY is a marker'},
            {'role': 'assistant', 'row_id': 4, 'text': 'NO_REPLY', 'status': 'error'}]}
        projected = self.display.result('session.history', source)
        self.assertEqual([r['row_id'] for r in projected['messages']], [1, 2, 3, 4])
        self.assertEqual([r['text'] for r in projected['messages']], ['NO_REPLY', '', 'NO_REPLY is a marker', 'NO_REPLY'])
        self.assertEqual(source['messages'][1]['text'], 'NO_REPLY')
        self.assertIsNone(projected['messages'][1]['codex_message_items'])
        replay = self.display.result('session.events.since', {'events': [
            {'type': 'message.start', 'session_id': 'chat', 'payload': {}},
            {'type': 'message.delta', 'session_id': 'chat', 'payload': {'text': 'NO_REPLY'}},
            {'type': 'message.complete', 'session_id': 'chat', 'payload': {'text': 'NO_REPLY'}}], 'latest_seq': 3})
        self.assertEqual(len(replay['events']), 2)
        self.assertEqual(replay['events'][-1]['payload']['text'], '')
        self.assertEqual(replay['latest_seq'], 3)
        self.assertEqual(self.display.prefixes, {})
