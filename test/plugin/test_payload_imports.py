"""Shipping inventory rejects a new module that works only in a source checkout."""
from pathlib import Path
import shutil
import tempfile
import unittest
from test_security import ROOT
from bot_web.payload import payload_paths, source_inventory, PRE_VOICE_FILES

class PayloadImportTests(unittest.TestCase):
    def test_commands_are_shipped_and_the_historical_omission_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'plugin'
            shutil.copytree(ROOT / 'plugins/bot-web', source, ignore=shutil.ignore_patterns('__pycache__'))
            self.assertIn((source / 'commands.py').resolve(), payload_paths(source))
            path = source / 'payload.py'
            path.write_text(path.read_text().replace("FILES = PRE_VOICE_FILES + ('live_voice.py', 'commands.py')", "FILES = PRE_VOICE_FILES + ('live_voice.py',)"))
            with self.assertRaisesRegex(ValueError, 'omits local import: commands.py'):
                payload_paths(source)

    def test_the_previous_additive_inventory_remains_readable_without_executing_code(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'payload.py'
            path.write_text('raise RuntimeError("never execute inspected code")\nPRE_VOICE_FILES = ' + repr(PRE_VOICE_FILES) + "\nFILES = PRE_VOICE_FILES + ('live_voice.py',)\n")
            self.assertEqual(source_inventory(Path(directory)), PRE_VOICE_FILES + ('live_voice.py',))
