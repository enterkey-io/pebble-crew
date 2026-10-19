"""Shipping inventory rejects a new module that works only in a source checkout."""
from pathlib import Path
import shutil
import tempfile
import unittest
from test_security import ROOT
from bot_web.payload import payload_paths, source_inventory, PRE_VOICE_FILES

class PayloadImportTests(unittest.TestCase):
    def test_shared_voice_source_is_shipped_and_an_omitted_dependency_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'plugin'
            shutil.copytree(ROOT / 'plugins/bot-web', source, ignore=shutil.ignore_patterns('__pycache__'))
            self.assertIn((source / 'voice_credentials.py').resolve(), payload_paths(source))
            path = source / 'payload.py'
            path.write_text(path.read_text().replace("FILES = PRE_VOICE_FILES + ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py', 'documents.py')", "FILES = PRE_VOICE_FILES + ('live_voice.py', 'commands.py')"))
            with self.assertRaisesRegex(ValueError, 'omits local import:'):
                payload_paths(source)

    def test_commands_are_shipped_and_the_historical_omission_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'plugin'
            shutil.copytree(ROOT / 'plugins/bot-web', source, ignore=shutil.ignore_patterns('__pycache__'))
            self.assertIn((source / 'commands.py').resolve(), payload_paths(source))
            path = source / 'payload.py'
            path.write_text(path.read_text().replace("FILES = PRE_VOICE_FILES + ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py', 'documents.py')", "FILES = PRE_VOICE_FILES + ('live_voice.py',)"))
            with self.assertRaisesRegex(ValueError, 'omits local import:'):
                payload_paths(source)

    def test_the_previous_additive_inventory_remains_readable_without_executing_code(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'payload.py'
            path.write_text('raise RuntimeError("never execute inspected code")\nPRE_VOICE_FILES = ' + repr(PRE_VOICE_FILES) + "\nFILES = PRE_VOICE_FILES + ('live_voice.py',)\n")
            self.assertEqual(source_inventory(Path(directory)), PRE_VOICE_FILES + ('live_voice.py',))

    def test_reporting_dependency_cannot_be_omitted_from_a_working_source_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'plugin'
            shutil.copytree(ROOT / 'plugins/bot-web', source, ignore=shutil.ignore_patterns('__pycache__'))
            path = source / 'payload.py'
            path.write_text(path.read_text().replace(
                "FILES = PRE_VOICE_FILES + ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py', 'documents.py')",
                "FILES = PRE_VOICE_FILES + ('live_voice.py', 'commands.py', 'voice_credentials.py')"))
            with self.assertRaisesRegex(ValueError, 'omits local import: reporting.py'):
                payload_paths(source)

    def test_document_dependency_cannot_be_omitted(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'plugin'
            shutil.copytree(ROOT / 'plugins/bot-web', source, ignore=shutil.ignore_patterns('__pycache__'))
            self.assertIn((source / 'documents.py').resolve(), payload_paths(source))
            path = source / 'payload.py'
            path.write_text(path.read_text().replace("FILES = PRE_VOICE_FILES + ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py', 'documents.py')", "FILES = PRE_VOICE_FILES + ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py')"))
            with self.assertRaisesRegex(ValueError, 'omits local import: documents.py'):
                payload_paths(source)
