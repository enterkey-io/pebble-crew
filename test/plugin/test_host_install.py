"""Install payload and persistent-state boundaries; no services, models or network."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
if "bot_web" not in sys.modules:
    spec = importlib.util.spec_from_file_location("bot_web", ROOT / "plugins/bot-web/__init__.py",
        submodule_search_locations=[str(ROOT / "plugins/bot-web")])
    module = importlib.util.module_from_spec(spec)
    sys.modules["bot_web"] = module
    spec.loader.exec_module(module)
from bot_web.host_install import payload_files, atomic_write, read_private, load_install, rollback, setup_link


class HostInstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)

    def payload(self):
        names = ['package.json', 'package-lock.json', 'apps/owner-node/dist/main.mjs',
                 'apps/owner-worker/migrations/0001_owner.sql', 'apps/web/dist/index.html',
                 'apps/web/dist/_headers', 'apps/web/dist/version.json']
        files = {}
        for name in names:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('disposable payload')
            files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest = {'schema': 1, 'version': '0.4.2', 'files': files}
        (self.root / 'payload.json').write_text(json.dumps(manifest))
        return manifest

    def config(self):
        value = {'schema': 1, 'origin': 'https://owner.example', 'web_port': 4001, 'bridge_port': 4002,
            'node': '/usr/bin/node', 'python': '/usr/bin/python', 'hermes_source': '/tmp/hermes',
            'hermes_home': '/tmp/hermes-home', 'operator_token': 'p' * 43,
            'active_release': 'a' * 24, 'previous_release': 'b' * 24, 'supervisor': 'external'}
        atomic_write(self.root / 'install.json', value)
        return value

    def test_checksum_and_complete_inventory_required(self):
        self.payload()
        self.assertEqual(len(payload_files(self.root)[1]), 7)
        (self.root / 'apps/web/dist/index.html').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            payload_files(self.root)

    def test_traversal_unlisted_files_and_symlinks_rejected(self):
        manifest = self.payload()
        manifest['files']['../outside'] = 'a' * 64
        (self.root / 'payload.json').write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            payload_files(self.root)
        self.payload()
        (self.root / 'extra.env').write_text('never package this')
        with self.assertRaisesRegex(ValueError, 'Unlisted'):
            payload_files(self.root)
        (self.root / 'extra.env').unlink()
        target = self.root / 'apps/web/dist/index.html'
        target.unlink()
        target.symlink_to(self.root / 'package.json')
        with self.assertRaisesRegex(ValueError, 'links'):
            payload_files(self.root)

    def test_atomic_private_state_and_no_link_overwrite(self):
        self.config()
        self.assertEqual(load_install(self.root)['active_release'], 'a' * 24)
        self.assertEqual((self.root / 'install.json').stat().st_mode & 0o777, 0o600)
        (self.root / 'alias').symlink_to(self.root / 'install.json')
        with self.assertRaises(ValueError):
            atomic_write(self.root / 'alias', {})
        (self.root / 'install.json').chmod(0o644)
        with self.assertRaises(ValueError):
            read_private(self.root / 'install.json')

    def test_rollback_changes_only_release_pointer(self):
        value = self.config()
        from bot_web.payload import copy_payload
        copy_payload(ROOT / 'plugins/bot-web', self.root / 'releases' / ('b' * 24))
        owner = self.root / 'owner'
        owner.mkdir()
        (owner / 'settings.json').write_text('do not rotate')
        with patch("bot_web.host_install.enrolled_runtime_paths", return_value={}):
            rollback(self.root)
        result = load_install(self.root)
        self.assertEqual(result['active_release'], value['previous_release'])
        self.assertEqual(result['previous_release'], value['active_release'])
        self.assertEqual(result['operator_token'], value['operator_token'])
        self.assertEqual((owner / 'settings.json').read_text(), 'do not rotate')

    def test_invalid_install_reference_is_not_executable(self):
        value = self.config()
        value['active_release'] = '../other'
        atomic_write(self.root / 'install.json', value)
        with self.assertRaises(ValueError):
            load_install(self.root)

    def test_missing_or_used_setup_proof_never_becomes_a_link(self):
        self.config()
        import sqlite3
        owner = self.root / 'owner'
        owner.mkdir()
        database = sqlite3.connect(owner / 'owner.sqlite')
        database.executescript('CREATE TABLE owner_claim(id INTEGER); INSERT INTO owner_claim VALUES(1);')
        database.close()
        with self.assertRaisesRegex(ValueError, 'already exists'):
            setup_link(self.root)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            setup_link(self.root, renew=True)
        self.assertFalse((self.root / 'setup-link.txt').exists())

    def test_renew_only_replaces_unclaimed_proof_and_preserves_keys(self):
        self.config()
        import sqlite3
        owner = self.root / 'owner'
        owner.mkdir()
        (owner / 'settings.json').write_text('existing signing keys')
        database = sqlite3.connect(owner / 'owner.sqlite')
        database.executescript('CREATE TABLE owner_claim(id INTEGER); CREATE TABLE owner_setup(id INTEGER PRIMARY KEY,value TEXT,expires INTEGER);')
        database.close()
        result = setup_link(self.root, renew=True)
        self.assertGreaterEqual(result['expires_in'], 86398)
        self.assertLessEqual(result['expires_in'], 86400)
        link = Path(result['private_setup_link_file']).read_text().strip()
        self.assertTrue(link.startswith('https://owner.example/#setup='))
        self.assertEqual(len(link.split('=')[-1]), 43)
        self.assertEqual((owner / 'settings.json').read_text(), 'existing signing keys')
        self.assertEqual((self.root / 'setup-link.txt').stat().st_mode & 0o777, 0o600)
