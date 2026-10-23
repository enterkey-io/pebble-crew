"""Owner opt-in routine setup; uncertainty never authorizes a second native cron create."""
import json
import re
import time
import uuid
from .operations import InvalidOperation, fields
from .work_store import fingerprint, operation_id
from .proactive_native import NativeProactive

PROACTIVE_OPERATIONS = {'work.proactive.status', 'work.proactive.suggest', 'work.proactive.enable', 'work.proactive.skip', 'work.proactive.receipt'}
TEMPLATES = {
    'calendar': {'name': 'Morning calendar brief', 'time': '09:00', 'days': 'weekdays',
        'prompt': 'Review my calendar for today. Summarize upcoming meetings, conflicts, preparation needed and useful reminders. Only read; do not change events or contact anyone. Keep the brief concise and deliver it here. If nothing needs attention, stay quiet.'},
    'inbox': {'name': 'Inbox check-in', 'time': '16:00', 'days': 'weekdays',
        'prompt': 'Review recent unread email. Summarize important messages that need my attention and any deadlines. Only read; do not send, draft, archive, delete or change messages. Keep the summary concise and deliver it here. If nothing needs attention, stay quiet.'},
}


def schedule(clock, days):
    if not isinstance(clock, str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', clock) or not isinstance(days, str) or days not in {'daily', 'weekdays', 'weekly'}:
        raise InvalidOperation('Choose a valid time and repeat schedule')
    hour, minute = clock.split(':')
    return f'{int(minute)} {int(hour)} * * ' + {'daily': '*', 'weekdays': '1-5', 'weekly': '1'}[days]


class Proactive:
    def __init__(self, workspace, ledger, native_factory=NativeProactive):
        self.workspace, self.ledger, self.native_factory = workspace, ledger, native_factory
        self.ledger.db.executescript('''CREATE TABLE IF NOT EXISTS proactive_proposals(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,main TEXT NOT NULL,incarnation TEXT NOT NULL,created INTEGER NOT NULL,evidence TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS proactive_setup(workspace TEXT PRIMARY KEY,seen INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS proactive_families(workspace TEXT NOT NULL,family TEXT NOT NULL,operation TEXT NOT NULL,main TEXT NOT NULL,PRIMARY KEY(workspace,family));''')

    def main(self):
        state = self.workspace.read()
        bot = state['bots'].get(state.get('orchestrator'))
        if not state.get('initialized') or not bot or not bot.get('enrolled') or not bot.get('available', True) or bot.get('deleted'):
            raise InvalidOperation('Set up your Main Pebble first', 'REQUIRES_SETUP')
        from hermes_cli.profiles import get_profile_dir
        from .search_native import identity
        if identity(get_profile_dir(bot['profile'])) != bot.get('native_incarnation'):
            raise InvalidOperation('The Main Pebble profile changed', 'STALE_REVISION')
        return state, bot

    def marker(self, state, family):
        return f'pebble-proactive:{state["id"]}:{family}:'

    def invoke(self, operation, params, actor):
        if actor != 'owner':
            raise InvalidOperation('The owner chooses proactive routines in the app')
        if operation == 'work.proactive.receipt':
            fields(params, ['workspace_id', 'operation_id'])
            state = self.workspace.read()
            if params['workspace_id'] != state['id']:
                raise InvalidOperation('Choose this workspace')
            with self.ledger.locked():
                intent = self.ledger.receipt(params['operation_id'], actor)
                if intent['state'] == 'reserved':
                    with self.ledger.db:
                        self.ledger.db.execute('DELETE FROM proactive_families WHERE workspace=? AND operation=?', (state['id'], intent['id']))
                if intent['state'] == 'uncertain' and intent.get('kind') == 'routine' and 'spec' in intent:
                    bot = next((b for b in state['bots'].values() if b['id'] == intent['main_id'] and b.get('native_incarnation') == intent['incarnation']), None)
                    from hermes_cli.profiles import get_profile_dir
                    from .search_native import identity
                    if bot and bot.get('available', True) and identity(get_profile_dir(bot['profile'])) == intent['incarnation']:
                        native = self.native_factory(bot['profile'])
                        matches = self.readback(native, intent)
                        return self.reconcile(intent['id'], intent['spec'], matches, intent)
                return intent
        state, main = self.main()
        if params.get('workspace_id') != state['id']:
            raise InvalidOperation('Choose this workspace')
        native = self.native_factory(main['profile'])
        if operation == 'work.proactive.status':
            fields(params, ['workspace_id'])
            with native.scoped():
                zone = native.timezone()
            pending = []
            for family, ident in self.ledger.db.execute('SELECT family,operation FROM proactive_families WHERE workspace=?', (state['id'],)):
                receipt = self.ledger.receipt(ident, 'owner')
                pending.append({'id': ident, 'name': TEMPLATES[family]['name'], 'state': receipt['state']})
            return {'workspace_id': state['id'], 'main_id': main['id'], 'main_name': main.get('name') or main['handle'], 'timezone': zone, 'routines': pending,
                'seen': self.ledger.db.execute('SELECT seen FROM proactive_setup WHERE workspace=?', (state['id'],)).fetchone() is not None}
        if operation == 'work.proactive.skip':
            fields(params, ['workspace_id'])
            with self.ledger.db:
                self.ledger.db.execute('INSERT OR REPLACE INTO proactive_setup VALUES(?,?)', (state['id'], int(time.time())))
            return {'saved': True}
        if operation == 'work.proactive.suggest':
            fields(params, ['workspace_id'])
            discovery = native.discover()
            jobs = native.jobs()
            suggestions = []
            for family, template in TEMPLATES.items():
                evidence = [c for c in discovery['capabilities'] if c['family'] == family]
                claimed = self.ledger.db.execute('SELECT operation FROM proactive_families WHERE workspace=? AND family=?', (state['id'], family)).fetchone()
                if evidence and not claimed and not any(self.marker(state, family) in (job.get('prompt') or '') for job in jobs):
                    suggestions.append({'id': family, **template, 'tools': [c['tool'] for c in evidence]})
            ident = str(uuid.uuid4())
            with self.ledger.locked(), self.ledger.db:
                current, now_main = self.main()
                if now_main['id'] != main['id'] or now_main.get('native_incarnation') != main.get('native_incarnation'):
                    raise InvalidOperation('The Main Pebble changed during discovery', 'STALE_REVISION')
                self.ledger.db.execute('INSERT INTO proactive_proposals VALUES(?,?,?,?,?,?)', (ident, state['id'], main['id'], main['native_incarnation'], int(time.time()), json.dumps({**discovery, 'suggestions': suggestions})))
                self.ledger.db.execute('DELETE FROM proactive_proposals WHERE created<?', (int(time.time()) - 86400,))
            return {'workspace_id': state['id'], 'proposal_id': ident, 'main_id': main['id'], 'main_name': main.get('name') or main['handle'], 'timezone': discovery['timezone'], 'suggestions': suggestions, 'unavailable': discovery['unavailable']}
        fields(params, ['workspace_id', 'proposal_id', 'operation_id', 'template_id', 'prompt', 'time', 'days', 'timezone'])
        operation_id(params['operation_id']); operation_id(params['proposal_id'])
        row = self.ledger.db.execute('SELECT main,incarnation,created,evidence FROM proactive_proposals WHERE id=? AND workspace=?', (params['proposal_id'], state['id'])).fetchone()
        if not row or row[:2] != (main['id'], main['native_incarnation']) or time.time() - row[2] > 600:
            raise InvalidOperation('Suggestions expired or the Main Pebble changed. Find suggestions again.', 'STALE_REVISION')
        evidence = json.loads(row[3])
        template = next((t for t in evidence['suggestions'] if t['id'] == params['template_id']), None)
        if not template or not isinstance(params['prompt'], str) or not 1 <= len(params['prompt'].strip()) <= 6000:
            raise InvalidOperation('Choose a current suggestion and instructions')
        expression = schedule(params['time'], params['days'])
        marker = self.marker(state, template['id']) + params['operation_id']
        spec = {'name': template['name'], 'schedule': expression, 'prompt': params['prompt'].strip() + '\n\n[' + marker + ']'}
        # Probe/list only. No model or external write action runs during setup.
        fresh = native.discover()
        if fresh['fingerprint'] != evidence['fingerprint'] or fresh['timezone'] != evidence['timezone'] or params['timezone'] != fresh['timezone']:
            raise InvalidOperation('Tools, permissions or timezone changed. Find suggestions again.', 'STALE_REVISION')
        with self.ledger.locked(), self.workspace.db:
            self.workspace.db.execute('BEGIN IMMEDIATE')
            _, now_main = self.main()
            if now_main['id'] != main['id'] or now_main['native_incarnation'] != main['native_incarnation']:
                raise InvalidOperation('The Main Pebble changed', 'STALE_REVISION')
            intent = self.ledger.reserve(params['operation_id'], actor, operation, params)
            if intent['state'] == 'completed':
                return intent
            jobs = native.jobs()
            if intent['state'] != 'reserved':
                return self.reconcile(intent['id'], spec, self.readback(native, intent), intent)
            claimed = self.ledger.db.execute('SELECT operation FROM proactive_families WHERE workspace=? AND family=?', (state['id'], template['id'])).fetchone()
            if claimed and claimed[0] != intent['id']:
                raise InvalidOperation('That routine has an existing or unconfirmed setup. Check its original receipt; ask your Main Pebble to adjust it.')
            if any(self.marker(state, template['id']) in (job.get('prompt') or '') for job in jobs):
                raise InvalidOperation('That routine already exists. Ask your Main Pebble to adjust it.')
            # Commit uncertainty before native persistence: a crash cannot cause replay.
            uncertain = {'kind': 'routine', 'spec': spec, 'main_id': main['id'], 'incarnation': main['native_incarnation'], 'marker': marker}
            with self.ledger.db:
                self.ledger.db.execute('INSERT OR IGNORE INTO proactive_families VALUES(?,?,?,?)', (state['id'], template['id'], intent['id'], main['id']))
            self.ledger.save(intent['id'], 'uncertain', uncertain)
            try:
                created = native.create(spec)
                if isinstance(created, dict) and isinstance(created.get('id'), str):
                    uncertain = {**uncertain, 'native_job_id': created['id']}
                    self.ledger.save(intent['id'], 'uncertain', uncertain)
            except Exception:
                pass
            return self.reconcile(intent['id'], spec, self.readback(native, uncertain), uncertain)

    def readback(self, native, intent):
        if intent.get('native_job_id'):
            job = native.job(intent['native_job_id'])
            return [job] if job else []
        return [job for job in native.jobs() if intent['marker'] in (job.get('prompt') or '')]

    def reconcile(self, ident, spec, jobs, evidence):
        if len(jobs) == 1:
            job = jobs[0]
            schedule = job.get('schedule') or {}
            if job.get('name') == spec['name'] and job.get('prompt') == spec['prompt'] and job.get('deliver') == 'bot-chat' and isinstance(job.get('enabled'), bool) and schedule.get('kind') == 'cron' and schedule.get('expr') == spec['schedule']:
                with self.ledger.db:
                    self.ledger.db.execute('INSERT OR REPLACE INTO proactive_setup VALUES(?,?)', (self.workspace.read()['id'], int(time.time())))
                return self.ledger.save(ident, 'completed', {'kind': 'routine', 'job_id': job['id'], 'name': job['name'], 'enabled': job['enabled']})
        return self.ledger.save(ident, 'uncertain', {k: v for k, v in evidence.items() if k not in {'id', 'state'}})
