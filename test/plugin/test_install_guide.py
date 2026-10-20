import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class InstallGuideTests(unittest.TestCase):
    def build(self, stale=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        for directory in ('scripts', 'docs', 'apps/web/public'):
            (root / directory).mkdir(parents=True)
        shutil.copyfile(ROOT / 'scripts/build-guide.py', root / 'scripts/build-guide.py')
        shutil.copyfile(ROOT / 'release.json', root / 'release.json')
        release = json.loads((root / 'release.json').read_text())
        source = (ROOT / 'docs/AGENT_INSTALL.md').read_text()
        if stale:
            source = source.replace(release['tag'], 'v0.0.1-preview.1')
        (root / 'docs/AGENT_INSTALL.md').write_text(source)
        result = subprocess.run([sys.executable, str(root / 'scripts/build-guide.py')],
                                capture_output=True, text=True)
        return root, release, result

    def test_public_guide_downloads_match_its_release(self):
        root, release, result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        public = root / 'apps/web/public'
        self.assertEqual((public / 'install.md').read_text(), (root / 'docs/AGENT_INSTALL.md').read_text())
        self.assertEqual(json.loads((public / 'version.json').read_text()), release)
        self.assertIn(f"/releases/download/{release['tag']}/workspace-plugin-preview.zip",
                      (public / 'install.html').read_text())

    def test_stale_download_links_fail_before_publication(self):
        root, _, result = self.build(stale=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('AGENT_INSTALL.md', result.stderr)
        self.assertFalse((root / 'apps/web/public/install.md').exists())
