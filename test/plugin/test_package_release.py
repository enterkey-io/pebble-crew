"""Release metadata must agree before any distributable archive is written."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PackageReleaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for directory in ('scripts', 'plugins/bot-web', 'apps/web/dist'):
            (self.root / directory).mkdir(parents=True)
        shutil.copyfile(ROOT / 'scripts/package.py', self.root / 'scripts/package.py')
        self.release = json.loads((ROOT / 'release.json').read_text())
        (self.root / 'release.json').write_text(json.dumps(self.release))
        self.plugin_version(self.release['bridge_version'])
        self.metadata_version(self.release['bridge_version'])
        self.built_version(self.release)

    def plugin_version(self, version):
        (self.root / 'plugins/bot-web/version.py').write_text(f'VERSION = {version!r}\n')

    def metadata_version(self, version):
        (self.root / 'plugins/bot-web/plugin.yaml').write_text(f'name: bot-web\nversion: {version}\n')

    def built_version(self, release):
        (self.root / 'apps/web/dist/version.json').write_text(json.dumps(release))

    def package(self):
        return subprocess.run([sys.executable, str(self.root / 'scripts/package.py')],
                              cwd=self.root, capture_output=True, text=True)

    def assert_rejected_before_archiving(self, message):
        result = self.package()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)
        self.assertFalse((self.root / 'artifacts').exists())

    def test_stale_python_plugin_version_is_rejected(self):
        self.plugin_version('0.0.0')
        self.assert_rejected_before_archiving('Plugin release versions disagree with release.json')

    def test_stale_plugin_metadata_is_rejected(self):
        self.metadata_version('0.0.0')
        self.assert_rejected_before_archiving('Plugin release versions disagree with release.json')

    def test_stale_built_ui_is_rejected(self):
        self.built_version({**self.release, 'bridge_version': '0.0.0'})
        self.assert_rejected_before_archiving('Built UI release differs from release.json')

    def test_matching_metadata_reaches_payload_validation(self):
        result = self.package()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing required startup or PWA assets', result.stderr)
