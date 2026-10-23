"""Prepare/read an existing-ID approval in the disposable native browser fixture."""
import hashlib
import json
import os
from pathlib import Path
import sys
from native_smoke import load_plugin

home = Path(sys.argv[1]).resolve()
assert home.name == 'home' and home.parent.name.startswith('bot-web-native-'), 'Disposable fixture home required'
os.environ['HERMES_HOME'] = str(home)
load_plugin(Path(__file__).resolve().parents[2])
from bot_web.workspace import WorkspaceStore
store = WorkspaceStore(home / 'bot-web/workspace.sqlite')
ident = '11111111-2222-4333-8444-555555555555'
try:
    state = store.read()
    if sys.argv[2] == 'seed':
        main = state['orchestrator']
        manager = state['bots']['beta']
        role = {key: '' for key in ('title', 'description', 'responsibilities', 'boundaries', 'expectedOutputs')}
        role.update(title='Operator', description='A synthetic pending creation')
        spec = {'name': 'ron', 'display_name': 'Ron', 'soul': 'Synthetic Ron. Preserve owner authority.', 'role': role,
                'model_source': 'default', 'model_fingerprint': state['model_grant']['fingerprint'], 'skills': [],
                'toolsets': ['workspace', 'skills'], 'manager': 'beta', 'team': None, 'expected_revision': state['revision']}
        raw = json.dumps(spec, sort_keys=True, separators=(',', ':'))
        fingerprint = hashlib.sha256(('agent.create' + raw).encode()).hexdigest()
        with store.db:
            store.db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,NULL,?)', (ident, main, 'agent.create', raw, fingerprint, 'pending', 1))
        other = state['bots']['alpha']
        update, _ = store.request(main, 'agent.update', {'profile': 'alpha', 'role': {**other['role'], 'description': 'Unrelated approved edit'}, 'manager': other['manager'], 'team': other['team'], 'expected_revision': state['revision']})
        import yaml
        path = home / 'SOUL.md' if main == 'default' else home / 'profiles' / main / 'SOUL.md'
        native = yaml.safe_load((home / ('profile.yaml' if main == 'default' else 'profiles/' + main + '/profile.yaml')).read_text()) or {}
        print(json.dumps({'id': ident, 'fingerprint': fingerprint, 'update': update, 'main': main, 'name': (native.get('ui_meta', {}).get('hermes-bots') or {}).get('title') or main, 'revision': state['revision']}))
    else:
        request = store.request_by_id(ident)
        assert request['state'] == 'completed', request
        assert state['bots']['ron']['manager_id'] == state['bots']['beta']['id']
        from hermes_state import SessionDB
        db = SessionDB(db_path=home / 'profiles/ron/state.db', read_only=True)
        try: assert db.get_session_by_title('Bot Chat')
        finally: db.close()
        approved = json.loads(store.db.execute('SELECT approved FROM request_context WHERE request=?', (ident,)).fetchone()[0])
        assert approved['legacy'] is True and approved['manager_identity'] == state['bots']['beta']['id']
        print(json.dumps({'id': ident, 'state': request['state'], 'fingerprint': request['fingerprint'], 'manager': state['bots']['ron']['manager'], 'canonical': True}))
finally: store.db.close()
