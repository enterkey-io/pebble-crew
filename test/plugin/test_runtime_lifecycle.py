"""Disposable disk transitions. No native processes, services or model calls."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
if 'bot_web' not in sys.modules:
    spec = importlib.util.spec_from_file_location('bot_web', ROOT / 'plugins/bot-web/__init__.py',
        submodule_search_locations=[str(ROOT / 'plugins/bot-web')])
    module = importlib.util.module_from_spec(spec)
    sys.modules['bot_web'] = module
    spec.loader.exec_module(module)
from bot_web import host_install as host, payload, setup


class RuntimeLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / 'source'
        payload.copy_payload(ROOT / 'plugins/bot-web', self.source)
        self.paths = {name: self.root / name / 'plugins/bot-web' for name in ('alpha', 'beta')}
        for destination in self.paths.values():
            payload.copy_payload(self.source, destination)
            (destination.parent.parent / 'SOUL.md').write_text('untouched synthetic personality')
        self.state = self.root / 'web'
        self.workspace = self.root / 'workspace.sqlite'
        self.addCleanup(patch.stopall)
        patch.object(host, 'enrolled_runtime_paths', return_value=self.paths).start()
        patch.object(host, 'state_dir', return_value=self.state).start()
        patch('bot_web.workspace.workspace_path', return_value=self.workspace).start()
        self.output = io.StringIO()

    def install(self, source):
        release = 'a' * 24
        target = self.state / 'releases' / release
        payload.copy_payload(source, target)
        host.atomic_write(self.state / 'install.json', {'schema': 1, 'origin': 'https://example.test',
            'web_port': 4001, 'bridge_port': 4002, 'node': '/usr/bin/node', 'python': '/usr/bin/python',
            'hermes_source': '/tmp/synthetic', 'hermes_home': str(self.root), 'operator_token': 'x' * 43,
            'active_release': release, 'previous_release': None, 'supervisor': 'external'})
        checksums = {str(path.relative_to(target)): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in payload.payload_paths(target)}
        host.atomic_write(target / 'release.json', {'files': checksums})
        return target

    def test_legacy_fingerprint_and_declared_pair_are_compatible(self):
        legacy = self.paths['alpha']
        (legacy / 'runtime-contract.json').unlink()
        self.assertEqual(host.runtime_evidence(legacy)['contract'], 'legacy-b642cce')
        host.preflight_runtimes(self.source)
        host.preflight_runtimes(legacy)
        (legacy / 'runtime.py').write_text('unknown customization')
        self.assertIsNone(host.runtime_evidence(legacy)['contract'])
        with self.assertRaisesRegex(ValueError, 'unverified'):
            host.preflight_runtimes(self.source)

    def test_unknown_contract_and_incomplete_payload_refused_before_writes(self):
        self.install(self.source)
        destination = self.paths['beta']
        (destination / 'runtime-contract.json').write_text(json.dumps(
            {'schema': 1, 'contract': 'future-v2', 'accepts': ['future-v2']}))
        before = {name: host.runtime_evidence(path)['sha256'] for name, path in self.paths.items()}
        with self.assertRaisesRegex(ValueError, 'unverified'):
            setup.sync_runtime(native_idle=True)
        self.assertEqual(before, {name: host.runtime_evidence(path)['sha256'] for name, path in self.paths.items()})
        self.assertFalse((self.root / 'rollback').exists())
        (destination / 'workspace.py').unlink()
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            host.runtime_evidence(destination)

    def test_native_managed_profile_without_a_runtime_can_be_provisioned(self):
        import shutil
        self.install(self.source)
        shutil.rmtree(self.paths['beta'])
        self.assertEqual(next(row for row in host.runtime_status(self.state, source=self.source)['profiles'] if row['profile'] == 'beta')['state'], 'not-installed')
        with contextlib.redirect_stdout(io.StringIO()):
            result = setup.sync_runtime(native_idle=True)
        row = next(row for row in result['profiles'] if row['profile'] == 'beta')
        self.assertTrue(result['complete'])
        self.assertIsNone(row['before_sha256'])
        self.assertIsNone(row['backup'])
        self.assertEqual(host.runtime_evidence(self.paths['beta'])['sha256'], result['source']['sha256'])

    def test_partial_sync_receipt_backup_retry_and_active_source(self):
        target = self.install(self.source)
        tool = target / 'runtime.py'
        tool.write_text(tool.read_text().replace('Describe your workspace', 'Inspect your workspace'))
        before = {name: host.runtime_evidence(path)['sha256'] for name, path in self.paths.items()}
        copy = payload.copy_payload
        def fail_second(source, destination):
            if destination.parent.parent.name == 'beta':
                raise OSError('synthetic write failure')
            return copy(source, destination)
        with contextlib.redirect_stdout(self.output), patch.object(payload, 'copy_payload', side_effect=fail_second):
            with self.assertRaisesRegex(OSError, 'synthetic'):
                setup.sync_runtime(native_idle=True)
        receipt = json.loads(self.output.getvalue())
        self.assertFalse(receipt['complete'])
        self.assertEqual([row['status'] for row in receipt['profiles']], ['copied', 'failed'])
        self.assertEqual(host.runtime_evidence(self.paths['alpha'])['sha256'], host.runtime_evidence(target)['sha256'])
        self.assertEqual(host.runtime_evidence(self.paths['beta'])['sha256'], before['beta'])
        for row in receipt['profiles']:
            backup = Path(row['backup'])
            self.assertEqual(host.runtime_evidence(backup)['sha256'], before[row['profile']])
            self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
            self.assertEqual((backup / 'runtime.py').stat().st_mode & 0o777, 0o600)
            self.assertEqual((self.paths[row['profile']].parent.parent / 'SOUL.md').read_text(), 'untouched synthetic personality')
        with contextlib.redirect_stdout(io.StringIO()):
            result = setup.sync_runtime(native_idle=True)
        self.assertTrue(result['complete'])
        self.assertEqual(result['source_kind'], 'active-release')
        self.assertEqual(result['runtime_copies_updated'], 2)
        self.assertEqual(json.loads(Path(receipt['receipt']).read_text())['complete'], False)

    def test_failed_replace_restores_original_and_retains_private_backup(self):
        self.install(self.source)
        before = host.runtime_evidence(self.paths['alpha'])['sha256']
        replace = setup.os.replace
        def fail(source, destination):
            if Path(source).name == '.bot-web-next':
                raise OSError('synthetic activation failure')
            return replace(source, destination)
        with patch.object(setup.os, 'replace', side_effect=fail), contextlib.redirect_stdout(self.output):
            with self.assertRaisesRegex(OSError, 'activation failure'):
                setup.sync_runtime(native_idle=True)
        receipt = json.loads(self.output.getvalue())
        self.assertFalse(receipt['complete'])
        self.assertEqual(host.runtime_evidence(self.paths['alpha'])['sha256'], before)
        self.assertTrue(Path(receipt['profiles'][0]['backup']).is_dir())

    def test_status_is_disk_evidence_and_never_claims_loaded_code(self):
        target = self.install(self.source)
        result = host.runtime_status(self.state, source=self.source)
        self.assertEqual(result['loaded_runtime'], 'unknown')
        self.assertEqual(result['packaged']['sha256'], result['active_host']['runtime']['sha256'])
        self.assertTrue(all(row['loaded'] == 'unknown' for row in result['profiles']))
        self.assertFalse(result['active_host']['integrity'])  # synthetic non-content-addressed release ID
        (target / 'runtime.py').write_text('changed after activation')
        self.assertNotEqual(host.runtime_status(self.state, source=self.source)['active_host']['sha256'], result['active_host']['sha256'])

    def test_explicit_idle_confirmation_and_pending_directory_are_required(self):
        self.install(self.source)
        with self.assertRaisesRegex(ValueError, 'native-idle'):
            setup.sync_runtime()
        pending = self.paths['alpha'].with_name('.bot-web-next')
        pending.mkdir()
        (pending / 'keep').write_text('earlier recovery evidence')
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, 'reconciliation'):
                setup.sync_runtime(native_idle=True)
        self.assertEqual((pending / 'keep').read_text(), 'earlier recovery evidence')

    def test_rollback_refuses_unknown_mixture_without_switching_host(self):
        self.install(self.source)
        previous = self.state / 'releases' / ('b' * 24)
        payload.copy_payload(self.source, previous)
        (previous / 'runtime-contract.json').write_text(json.dumps(
            {'schema': 1, 'contract': 'future-v2', 'accepts': ['future-v2']}))
        value = host.load_install(self.state)
        value['previous_release'] = 'b' * 24
        host.atomic_write(self.state / 'install.json', value)
        with self.assertRaisesRegex(ValueError, 'unverified'):
            host.rollback(self.state)
        self.assertEqual(host.load_install(self.state), value)
        (previous / 'runtime-contract.json').write_bytes((self.source / 'runtime-contract.json').read_bytes())
        host.rollback(self.state)
        self.assertEqual(host.load_install(self.state)['active_release'], 'b' * 24)

    def test_explicit_package_source_can_prepare_update_before_activation(self):
        active = self.install(self.source)
        with patch.object(setup, '__file__', str(self.source / 'setup.py')):
            runtime = self.source / 'runtime.py'
            runtime.write_text(runtime.read_text().replace('Describe your workspace', 'Inspect your workspace'))
            before = host.runtime_evidence(active)['sha256']
            with contextlib.redirect_stdout(io.StringIO()):
                result = setup.sync_runtime(native_idle=True, source_package=True)
            self.assertEqual(result['source_kind'], 'package')
            self.assertNotEqual(result['source']['sha256'], before)
            self.assertEqual(host.runtime_evidence(active)['sha256'], before)
            self.assertTrue(all(host.runtime_evidence(path)['sha256'] == result['source']['sha256']
                                for path in self.paths.values()))

    def test_sync_from_real_pre_contract_release_restores_legacy_payload(self):
        active = self.install(self.source)
        for name in ('runtime-contract.json', 'protocol-catalog.json'):
            (active / name).unlink()
        legacy = host.runtime_evidence(active)
        self.assertEqual(legacy['contract'], 'legacy-b642cce')
        with contextlib.redirect_stdout(io.StringIO()):
            result = setup.sync_runtime(native_idle=True)
        self.assertTrue(result['complete'])
        for destination in self.paths.values():
            self.assertFalse((destination / 'runtime-contract.json').exists())
            self.assertFalse((destination / 'protocol-catalog.json').exists())
            self.assertEqual(host.runtime_evidence(destination)['sha256'], legacy['sha256'])

    def test_linked_runtime_and_backup_contents_are_refused(self):
        self.install(self.source)
        link = self.paths['alpha'] / 'extra-link'
        link.symlink_to(self.source / 'runtime.py')
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, 'linked files'):
                setup.sync_runtime(native_idle=True)
        self.assertTrue(link.is_symlink())

    def test_unrelated_plugin_and_unsafe_inventory_are_rejected(self):
        (self.paths['alpha'] / 'plugin.yaml').write_text('name: unrelated-plugin')
        with self.assertRaisesRegex(ValueError, 'unrelated'):
            host.runtime_evidence(self.paths['alpha'])
        for name in ('../outside', '/tmp/outside', 'skills/../runtime.py'):
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                host.code_digest(self.source, [name])

    def test_inventory_read_does_not_create_or_repair_native_identity(self):
        patch.stopall()
        patch('bot_web.workspace.workspace_path', return_value=self.workspace).start()
        profiles = types.ModuleType('hermes_cli.profiles')
        profiles.get_profile_dir = lambda name: self.root / name
        with patch.dict(sys.modules, {'hermes_cli.profiles': profiles}):
            self.assertEqual(host.enrolled_runtime_paths(), {})
            self.assertFalse(self.workspace.exists())
            db = sqlite3.connect(self.workspace)
            db.execute('CREATE TABLE workspace(id INTEGER PRIMARY KEY, data TEXT)')
            db.execute('INSERT INTO workspace VALUES(1,?)', (json.dumps({'bots': {'alpha': {'enrolled': True, 'native_incarnation': 'bad'}}}),))
            db.commit()
            db.close()
            self.workspace.chmod(0o600)
            with self.assertRaisesRegex(ValueError, 'identity is unverified'):
                host.enrolled_runtime_paths()
            self.assertFalse((self.root / 'alpha/.pebble-crew-identity').exists())

    def test_home_alias_is_normalized_but_linked_plugin_directory_is_refused(self):
        patch.stopall()
        patch('bot_web.workspace.workspace_path', return_value=self.workspace).start()
        alias = self.root / 'home-alias'
        alias.symlink_to(self.root, target_is_directory=True)
        profiles = types.ModuleType('hermes_cli.profiles')
        profiles.get_profile_dir = lambda name: alias if name == 'default' else alias / name
        db = sqlite3.connect(self.workspace)
        db.execute('CREATE TABLE workspace(id INTEGER PRIMARY KEY, data TEXT)')
        db.execute('INSERT INTO workspace VALUES(1,?)', (json.dumps({'bots': {'alpha': {'enrolled': True}, 'default': {'enrolled': True}}}),))
        db.commit()
        db.close()
        self.workspace.chmod(0o600)
        with patch.dict(sys.modules, {'hermes_cli.profiles': profiles}):
            self.assertEqual(host.enrolled_runtime_paths()['alpha'], self.paths['alpha'])
            self.assertEqual(host.enrolled_runtime_paths()['default'], self.root / 'plugins/bot-web')
            import shutil
            shutil.rmtree(self.paths['alpha'].parent)
            self.paths['alpha'].parent.symlink_to(self.source, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'plugin directory is linked'):
                host.enrolled_runtime_paths()


if __name__ == '__main__':
    unittest.main()
