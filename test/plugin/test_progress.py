import json
import sys
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import test_security
from bot_web.progress import caption, register_runtime, runtime_guidance


class ProgressTests(unittest.TestCase):
    def test_caption_is_one_bounded_public_line(self):
        self.assertEqual(caption(' Checking available Claude models '), 'Checking available Claude models')
        for value in ('', '  ', 'x'*121, 'line\nbreak', 'hidden\u202e', '😀'*61, None, {'text':'wrong'}):
            with self.assertRaises((ValueError, UnicodeError)):
                caption(value)

    def handler(self):
        self.register = Mock()
        register_runtime(SimpleNamespace(register_tool=self.register))
        self.assertEqual(self.register.call_args.kwargs['name'], 'pebble_progress')
        self.assertFalse(self.register.call_args.kwargs['schema']['parameters']['additionalProperties'])
        return self.register.call_args.kwargs['handler']

    def test_only_the_verified_callers_live_session_receives_the_caption(self):
        handler = self.handler()
        server = SimpleNamespace(_sessions_lock=threading.RLock(), _sessions={
            'live-alpha':{'session_key':'saved-alpha'}, 'live-beta':{'session_key':'saved-beta'}}, _emit=Mock())
        store = Mock()
        env = SimpleNamespace(get_session_env=lambda name, default: 'saved-alpha' if name=='HERMES_SESSION_KEY' else default)
        with patch.dict(sys.modules, {'tui_gateway':SimpleNamespace(server=server), 'gateway.session_context':env}), \
             patch('bot_web.workspace.WorkspaceStore', return_value=store), \
             patch('bot_web.workspace.workspace_path', return_value='/synthetic'), \
             patch('bot_web.runtime.caller', side_effect=lambda store, sid: 'alpha' if sid in ('stored-alpha','saved-alpha') else 'beta'):
            result = json.loads(handler({'text':'Checking the website project'}, session_id='stored-alpha'))
            self.assertTrue(result['published'])
            server._emit.assert_called_once_with('status.update','live-alpha',{'kind':'progress','text':'Checking the website project'})
            server._emit.reset_mock()
            self.assertFalse(json.loads(handler({'text':'Wrong target'}, session_id='stored-beta'))['published'])
            self.assertFalse(json.loads(handler({'text':'Wrong fields','session_id':'live-beta'}, session_id='stored-alpha'))['published'])
            server._emit.assert_not_called()
            server._sessions['second-alpha']={'session_key':'saved-alpha'}
            self.assertFalse(json.loads(handler({'text':'Ambiguous'}, session_id='stored-alpha'))['published'])
        store.db.close.assert_called()

    def test_guidance_advertises_only_an_enabled_tool_and_includes_deferred_discovery(self):
        server = SimpleNamespace(_load_enabled_toolsets=lambda platform:['workspace'])
        definitions = Mock(return_value=[])
        with patch.dict(sys.modules, {'tui_gateway':SimpleNamespace(server=server), 'model_tools':SimpleNamespace(get_tool_definitions=definitions)}):
            self.assertEqual(runtime_guidance('tui'), '')
            definitions.return_value=[{'function':{'name':'pebble_progress'}}]
            self.assertIn('tool_describe(names=["pebble_progress"])', runtime_guidance('tui'))
            self.assertIn('never hidden reasoning', runtime_guidance('tui'))
