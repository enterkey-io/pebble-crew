"""Synthetic shared Codex grants; real native profile scopes, zero provider/model calls."""
import asyncio
import base64
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from unittest.mock import patch
from native_smoke import load_plugin, isolated_user_environment
ROOT = Path(__file__).resolve().parents[2]


def token(generation=0, account='synthetic-account'):
    claims = {'sub': 'synthetic-subject', 'exp': 1 + generation, 'https://api.openai.com/auth': {'chatgpt_account_id': account}}
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
    return 'eyJhbGciOiJub25lIn0.' + payload + '.synthetic'


def write_auth(path, generation=0, account='synthetic-account'):
    path.write_text(json.dumps({'providers': {'openai-codex': {'tokens': {'access_token': token(generation, account), 'refresh_token': 'synthetic-refresh-' + str(generation)}}}}))
    path.chmod(0o600)


async def exercise(home):
    from bot_web.native import NativeGateway, NativeError
    from hermes_cli.profiles import get_profile_dir
    from hermes_cli.config import read_user_config_raw, save_config
    from tui_gateway import server
    gateway = NativeGateway()
    await gateway.start()
    try:
        original = (home / 'auth.json').read_bytes()
        description = await gateway.call('bot_web.models', {'action': 'describe'})
        modern = gateway.build['version'] == '0.21.7'
        assert description['auth_kind'] == 'native_oauth'
        assert description['supported'] is modern, description
        assert (home / 'auth.json').read_bytes() == original
        if not modern:
            assert description['reason']['code'] == 'NATIVE_UPGRADE_REQUIRED'
            assert not (home / 'profiles' / 'codex-test').exists()
            print(json.dumps({'shared_codex_grant': 'safely-unsupported-on-legacy', 'model_calls': 0, 'provider_calls': 0}))
            return
        for name in ['codex-test', 'codex-peer']:
            result = await gateway.call('profiles.create', {'name': name, 'no_alias': True, 'no_skills': True, 'mirror_credentials': False, 'clone_channels': False})
            assert result['ok']
            granted = await gateway.call('bot_web.models', {'action': 'grant', 'profile': name, 'expected': description['fingerprint']})
            assert granted['configured'] and granted['runtime'] == 'unverified'
            target = Path(get_profile_dir(name))
            assert not (target / 'auth.json').exists(), 'OAuth store copied'
            assert 'synthetic-refresh' not in (target / '.env').read_text() if (target / '.env').exists() else True
        assert (home / 'auth.json').read_bytes() == original
        # Exercise native refresh twice, substituting ONLY the provider transport.
        from hermes_cli import auth
        refreshed = []
        def refresh(access, refresh, **kwargs):
            refreshed.append(refresh)
            generation = len(refreshed)
            return {'access_token': token(generation), 'refresh_token': 'synthetic-refresh-' + str(generation)}
        with patch.object(auth, 'refresh_codex_oauth_pure', refresh):
            for name in ['codex-test', 'codex-peer']:
                with server._session_profile_runtime_scope({'profile_home': str(get_profile_dir(name))}, hydrate_secrets=False):
                    auth.resolve_codex_runtime_credentials(force_refresh=True)
                assert not (Path(get_profile_dir(name)) / 'auth.json').exists(), 'Native refresh forked a child store'
        assert refreshed == ['synthetic-refresh-0', 'synthetic-refresh-1'], refreshed
        rotated = await gateway.call('bot_web.models', {'action': 'describe'})
        assert rotated['fingerprint'] == description['fingerprint'], 'Token rotation invalidated approval'
        # Materialized aliases must be rotation-stable without hiding route changes.
        source = json.loads((home / 'auth.json').read_text())
        singleton_tokens = source['providers']['openai-codex']['tokens']
        alias = {**singleton_tokens, 'id': 'synthetic-alias', 'source': 'device_code', 'auth_type': 'oauth'}
        source['credential_pool'] = {'openai-codex': [alias]}
        (home / 'auth.json').write_text(json.dumps(source))
        aliased = await gateway.call('bot_web.models', {'action': 'describe'})
        assert aliased['fingerprint'] == rotated['fingerprint'], 'Materialized alias changed the native policy'
        alias['priority'] = 7
        alias['request_count'] = 123
        (home / 'auth.json').write_text(json.dumps(source))
        scheduled = await gateway.call('bot_web.models', {'action': 'describe'})
        assert scheduled['fingerprint'] == aliased['fingerprint'], 'Normal account scheduling changed approval'
        alias['base_url'] = 'https://different-relay.invalid'
        (home / 'auth.json').write_text(json.dumps(source))
        rerouted = await gateway.call('bot_web.models', {'action': 'describe'})
        assert rerouted['fingerprint'] != aliased['fingerprint'], 'Changed alias route escaped approval'
        source.pop('credential_pool')
        (home / 'auth.json').write_text(json.dumps(source))
        # A selected model route must be evaluated prospectively in a fresh target.
        import yaml
        config = yaml.safe_load((home / 'config.yaml').read_text())
        config['model']['base_url'] = 'https://selected-relay.invalid'
        (home / 'config.yaml').write_text(yaml.safe_dump(config))
        routed = await gateway.call('bot_web.models', {'action': 'describe'})
        await gateway.call('bot_web.models', {'action': 'grant', 'profile': 'codex-test', 'expected': routed['fingerprint']})
        assert yaml.safe_load((Path(get_profile_dir('codex-test')) / 'config.yaml').read_text())['model']['base_url'] == 'https://selected-relay.invalid'
        config['model'].pop('base_url')
        (home / 'config.yaml').write_text(yaml.safe_dump(config))
        # Native provider-local overrides shadow root; grant must leave them untouched.
        override = Path(get_profile_dir('codex-test')) / 'auth.json'
        write_auth(override, account='synthetic-other-account')
        before = override.read_bytes()
        try:
            await gateway.call('bot_web.models', {'action': 'grant', 'profile': 'codex-test', 'expected': rotated['fingerprint']})
            raise AssertionError('Profile override was silently replaced')
        except NativeError:
            pass
        assert override.read_bytes() == before
        write_auth(home / 'auth.json', account='synthetic-changed-account')
        changed = await gateway.call('bot_web.models', {'action': 'describe'})
        assert changed['fingerprint'] != rotated['fingerprint']
        # A corrupt source must not produce native loader backup files.
        (home / 'auth.json').write_text('{broken-json')
        broken = await gateway.call('bot_web.models', {'action': 'describe'})
        assert not broken['supported'] and broken['reason']['code'] == 'AUTH_INVALID', broken
        assert (home / 'auth.json').read_text() == '{broken-json'
        assert not (home / 'auth.json.corrupt').exists()
        (home / 'auth.json').unlink()
        missing = await gateway.call('bot_web.models', {'action': 'describe'})
        assert not missing['supported'] and missing['reason']['code'] == 'AUTH_MISSING'
        # Pool-only source remains native; auth bytes are never mirrored or returned.
        pool = {'credential_pool': {'openai-codex': [{'id': 'synthetic-pool', 'source': 'manual', 'auth_type': 'oauth', 'access_token': token(), 'refresh_token': 'synthetic-pool-refresh', 'priority': 0}]}}
        (home / 'auth.json').write_text(json.dumps(pool))
        pooled = await gateway.call('bot_web.models', {'action': 'describe'})
        assert pooled['supported'], pooled
        assert (home / 'auth.json').read_text() == json.dumps(pool)
        assert 'synthetic-refresh' not in json.dumps([description, rotated, changed, broken, missing, pooled])
    finally:
        # Record only this disposable gateway's descendants before their parent exits.
        import psutil
        descendants = psutil.Process(gateway.process.pid).children(recursive=True) if gateway.process and gateway.process.returncode is None else []
        await gateway.stop()
        _, alive = await asyncio.to_thread(psutil.wait_procs, descendants, timeout=3)
        for child in alive:
            try: child.terminate()
            except psutil.NoSuchProcess: pass
        _, alive = await asyncio.to_thread(psutil.wait_procs, alive, timeout=3)
        for child in alive:
            try: child.kill()
            except psutil.NoSuchProcess: pass
        await asyncio.to_thread(psutil.wait_procs, alive, timeout=3)
    print(json.dumps({'shared_codex_grant': 'pass', 'native_refresh_source_and_rotation': 'pass', 'model_calls': 0, 'provider_calls': 0}))


with tempfile.TemporaryDirectory(prefix='pebble-codex-grant-') as directory:
    home = Path(directory) / 'home'; home.mkdir()
    isolated = isolated_user_environment(directory)
    os.environ.clear(); os.environ.update(isolated, HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory) / 'runtime'), HERMES_NO_AUTO_INSTALL='1', PYTHONPYCACHEPREFIX=str(Path(directory) / 'pycache'))
    shutil.copytree(ROOT / 'plugins/bot-web', home / 'plugins/bot-web', ignore=shutil.ignore_patterns('__pycache__'))
    (home / 'config.yaml').write_text('model:\n  provider: openai-codex\n  default: gpt-6.1-sol\nagent:\n  bot_mode_protocol: true\nplugins:\n  enabled: [bot-web]\n  entries:\n    bot-web:\n      enabled: true\n')
    write_auth(home / 'auth.json')
    load_plugin(ROOT)
    asyncio.run(exercise(home))
