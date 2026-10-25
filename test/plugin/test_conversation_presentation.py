from copy import deepcopy
import unittest
import test_security
from bot_web.conversation_presentation import project_message, project_result


class ConversationPresentationTests(unittest.TestCase):
    def test_background_completion_is_activity_without_model_prompt_or_output(self):
        notice = {'role': 'user', 'row_id': 41, 'timestamp': 1700000000,
            'display_kind': 'process_complete',
            'text': '[IMPORTANT: Background process fixture completed normally. PRIVATE_COMMAND_OUTPUT]',
            'display_metadata': {'display_text': 'Background process finished: fixture command'},
            'api_content': 'PRIVATE_MODEL_CONTEXT'}
        saved = deepcopy(notice)
        for method in ('session.resume', 'session.history', 'bot_web.conversation.snapshot'):
            result = project_result(method, {'messages': [notice]})
            self.assertEqual(result['messages'], [{'role': 'tool', 'name': 'process', 'text': '',
                'context': 'Background process finished: fixture command', 'row_id': 41, 'timestamp': 1700000000}])
            self.assertNotIn('PRIVATE', str(result))
        self.assertEqual(notice, saved, 'Display reads never rewrite native model/history content')

    def test_hidden_and_future_operational_rows_keep_coverage_without_owner_attribution(self):
        for kind in ('hidden', 'internal_notification', 'future_automation', {}, 7):
            result = project_message({'role': 'user', 'display_kind': kind, 'row_id': 55, 'text': 'PRIVATE'})
            self.assertEqual(result, {'role': 'system', 'row_id': 55})
        self.assertEqual(project_message({'role': 'assistant', 'display_kind': 'hidden', 'text': 'PRIVATE'}), {'role': 'system'})
        for kind in (None, '', 'steer', 'skill_invocation'):
            human = {'role': 'user', 'display_kind': kind, 'text': '[IMPORTANT: Background process is what I want to discuss]'}
            self.assertEqual(project_message(human), human)

    def test_native_search_uses_the_same_projection_and_cannot_return_operational_input(self):
        import importlib.util
        import sys
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import patch
        from bot_web import conversation_presentation
        spec = importlib.util.spec_from_file_location('search_native_test', Path(test_security.ROOT) / 'plugins/bot-web/search_native.py')
        search = importlib.util.module_from_spec(spec); spec.loader.exec_module(search)
        server = SimpleNamespace(_history_to_messages=lambda rows: [dict(row, text=row['content']) for row in rows])
        with patch.dict(sys.modules, {'tui_gateway': SimpleNamespace(server=server), 'conversation_presentation': conversation_presentation}):
            self.assertEqual(search.visible_text({'id': 1, 'role': 'user', 'content': 'PRIVATE', 'display_kind': 'process_complete'}, '/unused'), '')
            self.assertEqual(search.visible_text({'id': 2, 'role': 'user', 'content': 'Actual owner message'}, '/unused'), 'Actual owner message')

    def test_unverified_live_corrections_cannot_be_attributed_to_the_owner(self):
        import importlib.util
        import sys
        from pathlib import Path
        from threading import RLock
        from types import SimpleNamespace
        from unittest.mock import patch
        from bot_web import conversation_presentation
        spec = importlib.util.spec_from_file_location('test_native_presentation', Path(test_security.ROOT) / 'plugins/bot-web/native_extensions.py')
        with patch.dict(sys.modules, {'conversation_presentation': conversation_presentation}):
            extension = importlib.util.module_from_spec(spec); spec.loader.exec_module(extension)
        handlers = {}
        owner = {'role': 'user', '_row_id': 1, 'content': 'Owner question'}
        notice = {'role': 'user', '_row_id': 2, 'content': 'PRIVATE_BACKGROUND', 'display_kind': 'process_complete'}
        steer = {'role': 'user', '_row_id': 3, 'content': 'Owner redirect', 'display_kind': 'steer'}
        agent = SimpleNamespace(_session_messages=[owner, notice, steer], _persist_user_message_idx=0)
        session = {'running': True, 'history_lock': RLock(), 'history': [], 'agent': agent,
                   'inflight_turn': {'started_at': 7, 'user': 'Owner question'}}
        live = {'assistant': 'Live reply', 'corrections': ['PRIVATE_BACKGROUND'], 'correction_offsets': [3]}
        server = SimpleNamespace(method=lambda name: lambda fn: handlers.setdefault(name, fn),
            _sess_nowait=lambda *_: (session, None),
            _live_session_payload=lambda *_: {'running': True, 'turn_started_at': 7},
            _inflight_snapshot=lambda _: dict(live), _queued_prompt_snapshot=lambda _: None,
            _inflight_text=lambda value: str(value or ''), _ok=lambda _rid, value: value)
        with patch.dict(sys.modules, {'tui_gateway': SimpleNamespace(server=server)}):
            extension.register(Path(test_security.ROOT) / 'plugins/bot-web')
            snapshot = handlers['bot_web.conversation.snapshot'](1, {'session_id': 'synthetic'})
            self.assertEqual(snapshot['inflight']['corrections'], [])
            self.assertNotIn('PRIVATE_BACKGROUND', str(snapshot))
            live.update(corrections=['PRIVATE_BACKGROUND', 'Owner redirect'], correction_offsets=[3, 5])
            verified = handlers['bot_web.conversation.snapshot'](1, {'session_id': 'synthetic'})
            self.assertEqual(verified['inflight']['corrections'], ['Owner redirect'])
            self.assertEqual(verified['inflight']['correction_offsets'], [5])
            self.assertEqual(verified['correction_row_ids'], [3])

    def test_generic_native_reads_never_supply_unverified_live_owner_redirects(self):
        for method in ('session.resume', 'session.history'):
            native = {'inflight': {'user': 'PRIVATE_INPUT', 'assistant': 'Visible reply',
                      'corrections': ['PRIVATE_REDIRECT'], 'correction_offsets': [0]},
                      'correction_row_ids': [5]}
            result = project_result(method, native)
            self.assertEqual(result['inflight'], {'assistant': 'Visible reply', 'corrections': [], 'correction_offsets': []})
            self.assertNotIn('correction_row_ids', result)
            self.assertEqual(native['inflight']['corrections'], ['PRIVATE_REDIRECT'])

    def test_archived_lineage_and_stale_queued_rows_cannot_be_current_turn(self):
        import importlib.util
        import sys
        from pathlib import Path
        from threading import RLock
        from types import SimpleNamespace
        from unittest.mock import patch
        from bot_web import conversation_presentation
        spec = importlib.util.spec_from_file_location('archived_presentation', Path(test_security.ROOT) / 'plugins/bot-web/native_extensions.py')
        with patch.dict(sys.modules, {'conversation_presentation': conversation_presentation}):
            extension = importlib.util.module_from_spec(spec); spec.loader.exec_module(extension)
        old = {'role': 'user', '_row_id': 1, 'content': 'Make the photo'}
        old_reply = {'role': 'assistant', '_row_id': 2, 'content': 'Four-day-old reply'}
        newer = {'role': 'user', '_row_id': 10, 'content': 'Today'}
        handlers = {}
        session = {'running': True, 'history_lock': RLock(), 'history': [newer],
                   'display_history_prefix': [old, old_reply],
                   'agent': SimpleNamespace(_session_messages=[old, old_reply, newer], _persist_user_message_idx=0),
                   'inflight_turn': {'started_at': 7, 'user': 'Make the photo'},
                   'queued_prompts': [{'text': 'Make the photo', '_submit_user_row': old}]}
        server = SimpleNamespace(method=lambda name: lambda fn: handlers.setdefault(name, fn),
            _sess_nowait=lambda *_: (session, None),
            _live_session_payload=lambda *_: {'running': True, 'turn_started_at': 7},
            _inflight_snapshot=lambda _: {'assistant': 'Working on a photo'},
            _queued_prompt_snapshot=lambda _: None,
            _inflight_text=lambda value: str(value or ''), _ok=lambda _rid, value: value)
        with patch.dict(sys.modules, {'tui_gateway': SimpleNamespace(server=server)}):
            extension.register(Path(test_security.ROOT) / 'plugins/bot-web')
            snapshot = handlers['bot_web.conversation.snapshot'](1, {'session_id': 'synthetic'})
        self.assertNotIn('active_user_row_id', snapshot)
        self.assertEqual(snapshot['live_assistant_row_ids'], [])
        self.assertEqual(snapshot['deferred_prompts'], [])
