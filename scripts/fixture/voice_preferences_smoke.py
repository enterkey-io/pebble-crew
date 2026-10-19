"""Native preference round trips, with no provider calls or owner state."""
import json
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch
from native_smoke import load_plugin

ROOT = Path(__file__).resolve().parents[2]


def main():
    with tempfile.TemporaryDirectory(prefix='voice-preferences-native-') as temporary:
        home = Path(temporary)
        os.environ.clear()
        os.environ.update(HERMES_HOME=str(home), HERMES_NO_AUTO_INSTALL='1', PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin')
        env = b'OPENAI_API_KEY=synthetic-voice-test-only\n'
        (home / '.env').write_bytes(env)
        load_plugin(ROOT)
        from tools import voice_live
        from hermes_cli.config import save_config, read_user_config_raw
        from hermes_cli.web_server_profiles import _config_profile_scope
        from bot_web.live_voice import save_preferences, preferences
        cases = 0
        with _config_profile_scope('default'), patch('urllib.request.urlopen', side_effect=AssertionError('Preference checks must not call providers')):
            for inline in (False, True):
                for voice in (voice_live.GPT_LIVE_VOICES[0], voice_live.GPT_LIVE_VOICES[1], voice_live.GPT_LIVE_VOICES[-1]):
                    for speed in (1, 0.75):
                        live = {'instructions': 'Keep the owner instruction.', 'owner_setting': 'untouched'}
                        if inline:
                            live['api_key'] = 'synthetic-inline-test-only'
                        baseline = {'model': {'default': 'synthetic-existing-model'}, 'voice': {'gpt_live': live}}
                        save_config(baseline, strip_defaults=False)
                        result = save_preferences(voice, speed, False)
                        assert result['configured'] and result['key_confirmed'] and not result['setup_complete'], result
                        assert (result['voice'], result['speed']) == (voice, speed), result
                        assert preferences()['key_confirmed'], 'A second settings entry forgot the accepted saved key'
                        saved = read_user_config_raw()
                        assert saved['model'] == baseline['model']
                        assert saved['voice']['gpt_live']['owner_setting'] == 'untouched'
                        assert 'Keep the owner instruction.' in saved['voice']['gpt_live']['instructions']
                        assert saved['voice']['gpt_live'].get('api_key') == live.get('api_key')
                        assert (home / '.env').read_bytes() == env, 'Preference save altered credentials'
                        assert save_preferences(voice, speed, True)['setup_complete']
                        cases += 1
            for section in ('voice: null', 'voice:\n  gpt_live: null'):
                (home / 'config.yaml').write_text('model:\n  default: synthetic-existing-model\n' + section + '\n')
                result = save_preferences(voice_live.GPT_LIVE_VOICES[0], 1, False)
                assert result['key_confirmed'] and result['voice'] == voice_live.GPT_LIVE_VOICES[0], result
                assert read_user_config_raw()['model']['default'] == 'synthetic-existing-model'
                assert (home / '.env').read_bytes() == env
                cases += 1
        print(json.dumps({'native_voice_preferences': 'pass', 'cases': cases, 'default_voice': 'pass', 'remembered_key_confirmation': 'pass', 'credentials_unchanged': 'pass', 'provider_calls': 0}))


if __name__ == '__main__':
    main()
