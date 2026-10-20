"""Native preference round trips, with no provider calls or owner state."""
import json
import os
from pathlib import Path
import sys
import tempfile
import subprocess
from unittest.mock import patch
from native_smoke import load_plugin, isolated_user_environment

ROOT = Path(__file__).resolve().parents[2]


def main():
    with tempfile.TemporaryDirectory(prefix='voice-preferences-native-') as temporary:
        home = Path(temporary)
        os.environ.clear()
        os.environ.update(HERMES_HOME=str(home), HERMES_NO_AUTO_INSTALL='1', PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin')
        os.environ.update(isolated_user_environment(temporary))
        env = b'OPENAI_API_KEY=synthetic-voice-test-only\n'
        (home / '.env').write_bytes(env)
        (home / 'config.yaml').write_text('auth:\n  adopt_external_logins: false\n')
        load_plugin(ROOT)
        from tools import voice_live
        from hermes_cli.config import save_config, read_user_config_raw
        from hermes_cli.web_server_profiles import _config_profile_scope
        from bot_web.live_voice import save_preferences, preferences
        from bot_web.voice_credentials import resolve_source, save_shared_key
        cases = 0
        with _config_profile_scope('default'), patch('urllib.request.urlopen', side_effect=AssertionError('Preference checks must not call providers')):
            for inline in (False, True):
                for voice in (voice_live.GPT_LIVE_VOICES[0], voice_live.GPT_LIVE_VOICES[1], voice_live.GPT_LIVE_VOICES[-1]):
                    for legacy in (False, True):
                        live = {'instructions': 'Keep the owner instruction.', 'owner_setting': 'untouched'}
                        if legacy:
                            live['instructions'] += '\n\n[Pebble Crew delivery]\nAim for 2 times your normal speaking speed.\n[/Pebble Crew delivery]'
                            live['pebble_speed'] = 2
                        if inline:
                            live['api_key'] = 'synthetic-inline-test-only'
                        baseline = {'auth': {'adopt_external_logins': False}, 'model': {'default': 'synthetic-existing-model'}, 'voice': {'gpt_live': live}}
                        save_config(baseline, strip_defaults=False)
                        result = save_preferences(voice, False)
                        assert result['configured'] and result['key_confirmed'] and not result['setup_complete'], result
                        assert result['voice'] == voice and 'speed' not in result and 'speed_control' not in result, result
                        assert preferences()['key_confirmed'], 'A second settings entry forgot the accepted saved key'
                        saved = read_user_config_raw()
                        assert saved['model'] == baseline['model']
                        assert saved['voice']['gpt_live']['owner_setting'] == 'untouched'
                        assert saved['voice']['gpt_live']['instructions'] == 'Keep the owner instruction.'
                        assert 'pebble_speed' not in saved['voice']['gpt_live']
                        assert saved['voice']['gpt_live'].get('api_key') == live.get('api_key')
                        assert (home / '.env').read_bytes() == env, 'Preference save altered credentials'
                        assert save_preferences(voice, True)['setup_complete']
                        cases += 1
            for section in ('voice: null', 'voice:\n  gpt_live: null'):
                (home / 'config.yaml').write_text('auth:\n  adopt_external_logins: false\nmodel:\n  default: synthetic-existing-model\n' + section + '\n')
                result = save_preferences(voice_live.GPT_LIVE_VOICES[0], False)
                assert result['key_confirmed'] and result['voice'] == voice_live.GPT_LIVE_VOICES[0], result
                assert read_user_config_raw()['model']['default'] == 'synthetic-existing-model'
                assert (home / '.env').read_bytes() == env
                cases += 1
        from hermes_cli.profiles import create_profile
        peer = create_profile('voice-peer', no_alias=True, no_skills=True)
        (peer / '.env').write_text('OPENAI_API_KEY=synthetic-peer-reasoning-only\n')
        peer_env = (peer / '.env').read_bytes()
        (peer / 'SOUL.md').write_text('Synthetic existing personality sentinel.\n')
        with _config_profile_scope('voice-peer'), patch('urllib.request.urlopen', side_effect=AssertionError('No provider calls')):
            assert preferences()['key_confirmed'], 'The second agent asked to accept the same saved key again'
            assert resolve_source()['key'] == 'synthetic-voice-test-only', 'Voice borrowed the peer reasoning key'
            voice = voice_live.GPT_LIVE_VOICES[1]
            save_preferences(voice, True)
            assert preferences()['voice'] == voice
        with _config_profile_scope('default'):
            assert preferences()['voice'] == voice_live.GPT_LIVE_VOICES[0], 'Peer changed the primary voice'
            source = read_user_config_raw()
            source['voice']['gpt_live']['api_key'] = 'synthetic-rotated-key'
            save_config(source, strip_defaults=False)
        with _config_profile_scope('voice-peer'):
            assert not preferences()['key_confirmed'], 'A changed key inherited old consent'
        with _config_profile_scope('default'):
            source = read_user_config_raw()
            source['voice']['gpt_live'].pop('api_key')
            save_config(source, strip_defaults=False)
        with _config_profile_scope('voice-peer'):
            assert preferences()['key_confirmed']
            save_shared_key('synthetic-shared-voice-replacement')
            assert resolve_source()['key'] == 'synthetic-shared-voice-replacement'
            assert preferences()['key_confirmed'] and preferences()['voice'] == voice
        child = '''
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'scripts/fixture'))
from native_smoke import load_plugin
load_plugin(root)
from hermes_cli.web_server_profiles import _config_profile_scope
from bot_web.live_voice import preferences
with _config_profile_scope('voice-peer'):
    value = preferences()
    assert value['key_confirmed'] and value['setup_complete']
    print(json.dumps({'remembered_after_restart': True, 'voice': value['voice']}))
'''
        restarted = subprocess.run([sys.executable, '-c', child, str(ROOT)], check=True, capture_output=True, text=True)
        assert json.loads(restarted.stdout.strip().splitlines()[-1])['voice'] == voice
        assert (peer / '.env').read_bytes() == peer_env, 'Shared voice copied a key into another profile'
        assert (peer / 'SOUL.md').read_text() == 'Synthetic existing personality sentinel.\n'
        assert b'OPENAI_API_KEY=synthetic-voice-test-only\n' in (home / '.env').read_bytes(), 'Reasoning key changed'
        database = (home / 'bot-web/workspace.sqlite').read_bytes()
        assert b'synthetic-shared-voice-replacement' not in database, 'App metadata retained a plaintext key'
        cases += 1
        print(json.dumps({'native_voice_preferences': 'pass', 'cases': cases, 'default_voice': 'pass', 'remembered_key_confirmation': 'pass', 'shared_key_after_restart': 'pass', 'per_agent_voices': 'pass', 'other_profile_credentials_unchanged': 'pass', 'legacy_speed_cleanup': 'pass', 'provider_calls': 0}))


if __name__ == '__main__':
    main()
