import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo
import test_security
from bot_web import routines_native
from bot_web.conversation_presentation import ROUTINE_WAKE, owner_input, project_message
from bot_web.runtime import local_time

ENVELOPE = ('[Cronjob "workout-nudge" output — scheduled job, not the user. Review it, act on '
            'anything that needs action, and summarize for the chat.]\n\n')


class RoutineWakeTests(unittest.TestCase):
    def test_wake_constant_is_shared_with_presentation(self):
        self.assertEqual(routines_native.WAKE.strip(), ROUTINE_WAKE)

    def test_wake_script_prints_the_runbook_without_running_a_model(self):
        with tempfile.TemporaryDirectory() as home, patch('hermes_constants.get_hermes_home', lambda: Path(home)):
            runbook = 'Nudge Elliott about tonight’s 10-minute session.\n\n[pebble-proactive:w:calendar:]'
            relative = routines_native.wake_script(runbook)
            self.assertEqual(routines_native.wake_script(runbook), relative)
            path = Path(home) / 'scripts' / relative
            self.assertTrue(relative.startswith('pebble-routines/') and path.is_file())
            output = subprocess.run([sys.executable, str(path)], capture_output=True, text=True,
                                    encoding='utf-8', check=True).stdout
            self.assertEqual(output, 'Routine time. Do this now, here in our chat:\n\n'
                                     'Nudge Elliott about tonight’s 10-minute session.\n')
            # A changed runbook gets its own script; the old one stays for any running job.
            other = routines_native.wake_script('Something else')
            self.assertNotEqual(other, relative)
            self.assertTrue(path.is_file())

    def test_create_and_update_wake_the_pebble_instead_of_running_a_model(self):
        calls = []
        def cronjob(**params):
            calls.append(params)
            return json.dumps({'success': True, 'job_id': 'abc123'})
        class Native:
            def __init__(self, profile): pass
            def scoped(self):
                from contextlib import nullcontext
                return nullcontext()
        job = {'id': 'abc123', 'name': 'Nudge', 'prompt': 'old', 'schedule': {'kind': 'cron', 'expr': '0 21 * * *'},
               'deliver': 'bot-chat', 'enabled': True}
        modules = {'tools.cronjob_tools': SimpleNamespace(cronjob=cronjob),
                   'cron.jobs': SimpleNamespace(get_job=lambda ident: job, list_jobs=lambda **_: [job])}
        with tempfile.TemporaryDirectory() as home, patch.dict(sys.modules, modules), \
                patch('bot_web.proactive_native.NativeProactive', Native), \
                patch('hermes_constants.get_hermes_home', lambda: Path(home)):
            routines_native.manage('sarah', {'action': 'create', 'name': 'Nudge', 'prompt': 'Nudge him', 'schedule': '0 21 * * *'})
            routines_native.manage('sarah', {'action': 'update', 'job_id': 'abc123', 'expected': routines_native.config_revision(job),
                                             'name': 'Nudge', 'prompt': 'Nudge him gently', 'schedule': '0 21 * * *'})
            routines_native.manage('sarah', {'action': 'pause', 'job_id': 'abc123', 'expected': routines_native.config_revision(job)})
        create, update, pause = calls
        self.assertEqual((create['deliver'], create['no_agent'], create['prompt']), ('bot-chat', True, 'Nudge him'))
        self.assertTrue(create['script'].startswith('pebble-routines/'))
        self.assertTrue(update['no_agent'] and update['script'] != create['script'])
        self.assertNotIn('script', pause)

    def test_wake_turn_is_hidden_and_older_routine_results_show_as_the_pebble(self):
        wake = {'role': 'user', 'row_id': 9, 'timestamp': 4, 'text': ENVELOPE + routines_native.WAKE + 'Nudge him'}
        self.assertEqual(project_message(wake), {'role': 'system', 'row_id': 9, 'timestamp': 4})
        self.assertFalse(owner_input(wake))
        legacy = {'role': 'user', 'row_id': 10, 'text': ENVELOPE + 'Evening!\n![Wall sit](/p/cache/generated/a.jpg)'}
        self.assertEqual(project_message(legacy), {'role': 'assistant', 'row_id': 10,
                                                   'text': 'Evening!\n![Wall sit](/p/cache/generated/a.jpg)'})
        self.assertFalse(owner_input(legacy))
        for owner in ({'role': 'user', 'text': 'What is ' + ENVELOPE + 'this?'},
                      {'role': 'user', 'text': 'Make a routine for 9 PM'}):
            self.assertTrue(owner_input(owner))
            self.assertEqual(project_message(owner), owner)
        self.assertEqual(project_message({'role': 'assistant', 'text': ENVELOPE + 'x'})['text'], ENVELOPE + 'x')

    def test_every_turn_states_the_local_date_and_time(self):
        now = datetime(2026, 11, 10, 20, 58, tzinfo=ZoneInfo('America/Chicago'))
        self.assertEqual(local_time(now), 'It is now Tuesday, November 10, 2026, 8:58 PM (America/Chicago). '
                                          'Use this for today, tonight, tomorrow and schedules.')


if __name__ == '__main__':
    unittest.main()
