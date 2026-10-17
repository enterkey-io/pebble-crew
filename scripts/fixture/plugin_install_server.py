"""Install the actual combined archive with the real Hermes CLI in a disposable home.

Test control endpoints exist only in this fixture and are never packaged.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urlsplit
from zipfile import ZipFile

from native_smoke import Model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--source', required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--web-port', required=True)
    parser.add_argument('--bridge-port', required=True)
    parser.add_argument('--cert', required=True)
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[2]
    directory = args.directory.resolve()
    home = directory / 'hermes-home'
    home.mkdir()
    archive = (args.archive or project / 'artifacts/packages/workspace-plugin-preview.zip').resolve()
    manifest = json.loads((archive.parent / 'workspace-manifest.json').read_text())
    record = next(item for item in manifest['artifacts'] if item['name'] == archive.name)
    assert archive.stat().st_size == record['bytes']
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == record['sha256']
    unpack = directory / 'unpacked'
    with ZipFile(archive) as zipped:
        assert all(not Path(item.filename).is_absolute() and '..' not in Path(item.filename).parts
                   and not stat.S_ISLNK(item.external_attr >> 16) for item in zipped.infolist())
        zipped.extractall(unpack)
    plugin = home / 'plugins/bot-web'
    plugin.parent.mkdir()
    shutil.copytree(unpack / 'bot-web', plugin)
    os.environ.clear()
    os.environ.update(PATH=f'{Path(sys.executable).parent}:{Path(args.node).parent}:/usr/bin:/bin',
        HOME=str(directory), HERMES_HOME=str(home), PYTHONPATH=args.source,
        HERMES_RUNTIME_DIR=str(directory / 'native-runtime'), PYTHONDONTWRITEBYTECODE='1',
        HERMES_NO_AUTO_INSTALL='1', HERMES_GUEST_ONBOARDING='0', NO_PROXY='127.0.0.1,localhost')
    sys.path.insert(0, args.source)
    model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
    Model.audit_requests = True
    threading.Thread(target=model.serve_forever, daemon=True).start()
    from hermes_cli.profiles import create_profile
    config = ("model:\n  default: fixture-model\n  provider: custom:fixture\nproviders:\n"
        f"  fixture:\n    base_url: http://127.0.0.1:{model.server_port}/v1\n    api_key: fixture-only\n"
        "agent:\n  max_turns: 3\n  bot_mode_protocol: true\napprovals:\n  mode: manual\ntoolsets:\n  - terminal\n")
    (home / 'config.yaml').write_text(config)
    (home / '.env').write_text('# Synthetic fixture only\n')
    (home / 'SOUL.md').write_text('You are the existing synthetic Aurora personality.\n')
    soul_digest = hashlib.sha256((home / 'SOUL.md').read_bytes()).hexdigest()
    for name in ('alpha', 'beta', 'gamma'):
        profile = create_profile(name, no_alias=True, no_skills=True)
        (profile / 'config.yaml').write_text(config)
        (profile / 'SOUL.md').write_text(f'You are the existing synthetic {name} personality.\n')
    checks = {'archive_checksum_and_safe_extraction': True}
    checks['starts_with_ordinary_agents_and_zero_managed_bots'] = all(
        'hermes-bots' not in path.read_text() for path in home.rglob('profile.yaml'))

    def cli(*arguments, expect_failure=False):
        result = subprocess.run([sys.executable, '-m', 'hermes_cli.main', 'bot-web', *arguments],
            cwd=home, capture_output=True, text=True, timeout=200)
        not_ready = arguments[0] == 'status' and result.returncode == 2
        if (result.returncode == 0 or not_ready) == expect_failure:
            raise AssertionError('Installed CLI action failed: ' + arguments[0] + '\n' + result.stderr[-2000:]
                + ('\n' + result.stdout[-2000:] if arguments[0] in {'status', 'verify'} else ''))
        if expect_failure:
            return result
        start = result.stdout.find('{')
        return json.loads(result.stdout[start:])

    help_result = subprocess.run([sys.executable, '-m', 'hermes_cli.main', 'plugins', 'enable', '--help'],
        cwd=home, capture_output=True, text=True, timeout=30)
    enable_args = ['plugins', 'enable', 'bot-web']
    if '--yes-deps' in help_result.stdout:
        enable_args.append('--yes-deps')
    enabled = subprocess.run([sys.executable, '-m', 'hermes_cli.main', *enable_args],
        cwd=home, capture_output=True, text=True, timeout=200)
    if enabled.returncode:
        raise AssertionError('Native plugin enable failed: ' + enabled.stderr[-2000:] + enabled.stdout[-1000:])
    checks['real_native_plugin_enable'] = True
    assert cli('doctor')['supported']
    installed = cli('install', '--origin', args.origin, '--web-port', args.web_port,
        '--bridge-port', args.bridge_port, '--node', args.node, '--supervisor', 'external')
    state = Path(installed['state'])
    settings = state / 'owner/settings.json'
    key_digest = hashlib.sha256(settings.read_bytes()).hexdigest()
    active = json.loads((state / 'install.json').read_text())['active_release']
    repeated = cli('install', '--origin', args.origin, '--node', args.node, '--supervisor', 'external')
    checks['repeat_install_preserves_keys_and_release'] = (not repeated['changed']
        and hashlib.sha256(settings.read_bytes()).hexdigest() == key_digest)
    # Crash window: owner initialization committed, install receipt not yet written.
    (state / 'install.json').unlink()
    cli('install', '--origin', args.origin, '--web-port', args.web_port,
        '--bridge-port', args.bridge_port, '--node', args.node, '--supervisor', 'external')
    checks['interrupted_first_install_reuses_existing_keys'] = hashlib.sha256(settings.read_bytes()).hexdigest() == key_digest
    assert cli('service')['supervised'] is False
    checks['external_supervision_not_claimed_as_complete'] = True
    cli('setup-link')
    manager = subprocess.Popen([sys.executable, str(state / 'launcher.py')], env=os.environ,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    stop = threading.Event()
    outer_restarts = 0

    def supervise_manager():
        nonlocal manager, outer_restarts
        while not stop.wait(0.2):
            if manager.poll() is not None:
                manager = subprocess.Popen([sys.executable, str(state / 'launcher.py')], env=os.environ,
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                outer_restarts += 1
    threading.Thread(target=supervise_manager, daemon=True).start()

    def ready():
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            status = cli('status')
            if status['ready']:
                return status
            time.sleep(0.4)
        raise AssertionError('Installed combined services did not become ready')

    def rpc(operation, params):
        value = json.loads((state / 'install.json').read_text())
        headers = {'Host': urlsplit(args.origin).netloc, 'Origin': args.origin,
                   'Authorization': 'Bearer ' + value['operator_token'], 'Content-Type': 'application/json'}
        base = f"http://127.0.0.1:{args.bridge_port}"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(urllib.request.Request(base + '/v1/connect', data=b'', headers=headers), timeout=30) as response:
            lease = json.load(response)['connection']
        headers['X-Bot-Connection'] = lease
        try:
            with opener.open(urllib.request.Request(base + '/v1/rpc',
                data=json.dumps({'operation': operation, 'params': params}).encode(), headers=headers), timeout=60) as response:
                return json.load(response)['result']
        finally:
            with opener.open(urllib.request.Request(base + '/v1/connect', method='DELETE', headers=headers), timeout=30):
                pass

    def tool_marker(path):
        result = subprocess.run([sys.executable, str(project / 'scripts/fixture/runtime_marker.py'), str(path)],
            cwd=home, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr[-2000:]
        return json.loads(result.stdout)

    def historical_rollback_release():
        """Exact pre-contract Python payload with this archive's web assets/dependencies."""
        value = json.loads((state / 'install.json').read_text())
        source = state / 'releases' / value['previous_release']
        target = directory / 'legacy-rollback-staging'
        shutil.copytree(source, target, symlinks=True)
        metadata = json.loads((target / 'release.json').read_text())
        metadata['version'] = '0.7.6'
        names = list(metadata['files'])
        for name in names:
            if name.startswith('web-runtime/'):
                continue
            if name in {'runtime-contract.json', 'protocol-catalog.json'}:
                (target / name).unlink()
                del metadata['files'][name]
                continue
            old = subprocess.run(['git', 'show', 'b642ccef86511814223e9c4443fc48f639965b47:plugins/bot-web/' + name],
                cwd=project, capture_output=True, timeout=30)
            assert old.returncode == 0, 'Historical runtime source is unavailable; fetch repository history before acceptance'
            (target / name).write_bytes(old.stdout)
            metadata['files'][name] = hashlib.sha256(old.stdout).hexdigest()
        identity = hashlib.sha256(json.dumps(metadata['files'], sort_keys=True).encode()).hexdigest()[:24]
        (target / 'release.json').write_text(json.dumps(metadata))
        target.chmod(0o700)
        target.rename(state / 'releases' / identity)
        value['previous_release'] = identity
        (state / 'install.json').write_text(json.dumps(value))
        return identity

    runtime_paths = {}
    runtime_original = {}
    protected_files = {}

    class Control(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            nonlocal active
            try:
                if self.path.startswith('/fault/'):
                    kind = self.path.removeprefix('/fault/')
                    services = json.loads((state / 'service.json').read_text())
                    if kind == 'manager':
                        pid = manager.pid
                    elif kind == 'native':
                        parent = services['children']['bridge']
                        children = subprocess.check_output(['pgrep', '-P', str(parent), '-f', 'native_entry.py'], text=True)
                        pid = int(children.strip().splitlines()[0])
                    else:
                        pid = services['children'][kind]
                    os.kill(pid, signal.SIGKILL)
                    result = {'fault_injected': kind}
                elif self.path == '/audit':
                    from collections import Counter
                    result = {'request_paths': dict(Counter(row['path'] for row in Model.request_audit)), 'count': Model.turns}
                elif self.path == '/update':
                    turns = Model.turns
                    from hermes_cli.profiles import get_profile_dir
                    for profile in ('alpha', 'beta'):
                        snapshot = rpc('workspace.describe', {})
                        bot = next(row for row in snapshot['bots'] if row['profile'] == profile)
                        rpc('agent.onboard', {'profile': profile, 'id': bot['id'], 'name': profile.title(),
                            'handle': profile, 'appearance': bot['appearance'], 'photo': None,
                            'role': bot['role'], 'manager': snapshot['orchestrator'], 'expected_revision': snapshot['revision']})
                        path = Path(get_profile_dir(profile)) / 'plugins/bot-web'
                        runtime_paths[profile] = path
                        runtime_original[profile] = tool_marker(path)
                        (path / 'runtime-contract.json').unlink()
                    initial = cli('runtime-status')
                    checks['legacy_runtime_copies_recognized'] = all(row['contract'] == 'legacy-b642cce'
                        for row in initial['profiles'] if row['profile'] in runtime_paths)
                    checks['runtime_loaded_state_explicitly_unknown'] = initial['loaded_runtime'] == 'unknown'
                    for profile in ('default', 'alpha', 'beta'):
                        home_path = Path(get_profile_dir(profile))
                        for name in ('SOUL.md', '.env', '.pebble-crew-identity', 'config.yaml', 'profile.yaml'):
                            path = home_path / name
                            if path.is_file():
                                protected_files[path] = hashlib.sha256(path.read_bytes()).hexdigest()
                    runtime = plugin / 'runtime.py'
                    original = runtime.read_text()
                    modified = original.replace('Describe your workspace or propose a team change for owner approval.',
                        'Inspect your workspace or propose a team change for owner approval.')
                    assert modified != original
                    runtime.write_text(modified)
                    pending = runtime_paths['beta'].with_name('.bot-web-next')
                    pending.mkdir()
                    (pending / 'keep').write_text('synthetic interrupted staging')
                    failed = cli('sync-runtime', '--source-package', '--native-idle', expect_failure=True)
                    partial = json.loads(failed.stdout[failed.stdout.find('{'):])
                    checks['partial_runtime_sync_is_not_success'] = (not partial['complete']
                        and any(row['profile'] == 'alpha' and row['status'] == 'copied' for row in partial['profiles'])
                        and any(row['profile'] == 'beta' and row['status'] == 'failed' for row in partial['profiles'])
                        and tool_marker(runtime_paths['alpha']) != runtime_original['alpha']
                        and tool_marker(runtime_paths['beta']) == runtime_original['beta'])
                    checks['partial_sync_preserves_private_backup'] = all(
                        Path(row['backup']).is_dir() and Path(row['backup']).stat().st_mode & 0o777 == 0o700
                        for row in partial['profiles'] if row['status'] == 'copied')
                    assert (pending / 'keep').read_text() == 'synthetic interrupted staging'
                    shutil.rmtree(pending)
                    synced = cli('sync-runtime', '--source-package', '--native-idle')
                    assert synced['complete']
                    cli('update')
                    current = json.loads((state / 'install.json').read_text())['active_release']
                    evidence = cli('runtime-status')
                    checks['installed_code_update_changes_release'] = current != active
                    checks['host_and_named_runtime_digests_match_after_sync'] = all(
                        row['sha256'] == evidence['active_host']['runtime']['sha256']
                        for row in evidence['profiles'] if row['profile'] in runtime_paths)
                    checks['actual_registered_tool_marker_changes'] = all(
                        tool_marker(path) != runtime_original[name] for name, path in runtime_paths.items())
                    checks['update_preserves_login_keys'] = hashlib.sha256(settings.read_bytes()).hexdigest() == key_digest
                    checks['update_and_runtime_sync_run_zero_model_turns'] = Model.turns == turns
                    active = current
                    result = {'updated': True, 'runtime_receipt': synced['receipt']}
                elif self.path == '/verify':
                    result = cli('verify', '--public', '--ca-file', args.cert)
                    checks['public_https_cli_stream_and_heartbeat'] = result['ready']
                elif self.path == '/rollback':
                    turns = Model.turns
                    legacy = historical_rollback_release()
                    cli('rollback')
                    restored = cli('sync-runtime', '--native-idle')
                    assert restored['complete']
                    checks['rollback_copies_exact_pre_contract_runtime'] = all(
                        not (path / 'runtime-contract.json').exists() and not (path / 'protocol-catalog.json').exists()
                        for path in runtime_paths.values())
                    checks['rollback_restores_actual_runtime_tool_marker'] = all(
                        tool_marker(path) == runtime_original[name] for name, path in runtime_paths.items())
                    checks['rollback_runs_zero_model_turns'] = Model.turns == turns
                    current = json.loads((state / 'install.json').read_text())['active_release']
                    assert current == legacy
                    checks['explicit_rollback_restores_previous_release'] = current != active
                    checks['rollback_preserves_login_keys'] = hashlib.sha256(settings.read_bytes()).hexdigest() == key_digest
                    active = current
                    result = {'rolled_back': True}
                elif self.path == '/failed-update':
                    turns = Model.turns
                    bundle = plugin / 'web-runtime/apps/owner-node/dist/main.mjs'
                    previous_bundle = bundle.read_bytes()
                    inventory = plugin / 'web-runtime/payload.json'
                    previous_inventory = inventory.read_bytes()
                    try:
                        bundle.write_bytes(b"throw new Error('synthetic startup failure');\n" + previous_bundle)
                        payload = json.loads(previous_inventory)
                        payload['files']['apps/owner-node/dist/main.mjs'] = hashlib.sha256(bundle.read_bytes()).hexdigest()
                        inventory.write_text(json.dumps(payload))
                        cli('update', expect_failure=True)
                        current = json.loads((state / 'install.json').read_text())['active_release']
                        checks['failed_activation_restores_previous_release'] = current == active
                        checks['failed_activation_preserves_login_keys'] = hashlib.sha256(settings.read_bytes()).hexdigest() == key_digest
                        ready()
                        checks['failed_activation_runs_zero_model_turns'] = Model.turns == turns
                        checks['failed_activation_preserves_profile_runtime'] = all(
                            tool_marker(path) == runtime_original[name] for name, path in runtime_paths.items())
                    finally:
                        bundle.write_bytes(previous_bundle)
                        inventory.write_bytes(previous_inventory)
                    result = {'previous_release_restored': current == active}
                else:
                    raise ValueError('Unknown fixture control')
                result['outer_manager_restarts'] = outer_restarts
                data = json.dumps(result).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
            except Exception as error:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(error).encode())

    control = ThreadingHTTPServer(('127.0.0.1', 0), Control)
    threading.Thread(target=control.serve_forever, daemon=True).start()
    try:
        ready()
        checks['installed_service_ready_without_model_turns'] = Model.turns == 0
        (directory / 'ready.json').write_text(json.dumps({'state': str(state), 'control_port': control.server_port}))
        while not stop.wait(0.2):
            if (directory / 'stop').exists():
                break
    finally:
        stop.set()
        manager.terminate()
        try:
            manager.wait(timeout=20)
        except subprocess.TimeoutExpired:
            manager.kill()
            manager.wait()
        checks['exact_archive_unchanged_during_acceptance'] = hashlib.sha256(archive.read_bytes()).hexdigest() == record['sha256']
        checks['outer_manager_restart_exercised'] = outer_restarts > 0
        checks['profile_credentials_config_and_identity_preserved'] = all(
            hashlib.sha256(path.read_bytes()).hexdigest() == digest for path, digest in protected_files.items())
        checks['primary_soul_preserved'] = hashlib.sha256((home / 'SOUL.md').read_bytes()).hexdigest() == soul_digest
        checks['no_replayed_model_sends_after_recovery'] = Model.turns == 1
        (directory / 'installation-results.json').write_text(json.dumps({'checks': checks,
            'package_sha256': record['sha256'], 'initial_release': json.loads((state / 'install.json').read_text())['active_release'],
            'synthetic_model_turns': Model.turns}, indent=2))
        control.shutdown()
        model.shutdown()


if __name__ == '__main__':
    main()
