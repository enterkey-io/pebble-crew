from pathlib import Path
import tempfile
import unittest
import test_security  # noqa: F401  (puts bot_web on the path)
from bot_web.lifecycle_native import read_clock


class ReplyCursorTests(unittest.TestCase):
    """The unread mark and alert fallback follow only messages a Pebble sent the owner."""

    def setUp(self):
        from hermes_state import SessionDB
        self.home = Path(tempfile.mkdtemp())
        self.db = SessionDB(db_path=self.home / 'state.db')
        self.db.create_session('chat', 'cli')
        self.db.set_session_title('chat', 'Bot Chat')
        self.addCleanup(self.db.close)

    def add(self, role, content=None, **extra):
        return self.db.append_message('chat', role, content, **extra)

    def cursor(self):
        return read_clock(self.home)['cursor']

    def test_tool_steps_background_prompts_and_silence_do_not_move_the_cursor(self):
        self.add('user', 'What is on my calendar?')
        self.add('assistant', 'Let me check.', tool_calls=[{'id': 'c1', 'type': 'function',
                 'function': {'name': 'calendar', 'arguments': '{}'}}])
        self.add('tool', '{"events": []}', tool_call_id='c1')
        reply = self.add('assistant', 'Nothing today.')
        self.assertEqual(self.cursor(), reply)
        # Background work: a routine prompt, tool steps, then a silent ending.
        self.add('user', 'Scheduled check: anything new?')
        self.add('assistant', None, tool_calls=[{'id': 'c2', 'type': 'function',
                 'function': {'name': 'inbox', 'arguments': '{}'}}])
        self.add('tool', '[]', tool_call_id='c2')
        self.add('assistant', 'NO_REPLY')
        self.add('assistant', 'Summary for the model.', display_metadata={'model_only': True})
        # The owner's own message is not something to read either.
        self.add('user', 'Thanks')
        self.assertEqual(self.cursor(), reply)
        later = self.add('assistant', 'You have a new email from Sam.')
        self.assertEqual(self.cursor(), later)

    def test_a_chat_with_no_reply_yet_has_nothing_unread(self):
        self.add('user', 'Hello')
        self.assertEqual(self.cursor(), 0)
