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
