"""Actual deferred management tools, avatars, layouts, groups and cron in disposable Hermes homes."""
import asyncio
import base64
from copy import deepcopy
from http.server import ThreadingHTTPServer
import json
import io
from importlib.util import find_spec
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import uuid
from native_smoke import Model as BaseModel, isolated_user_environment, load_plugin, seed

REQUIRED = {'sidebar.describe', 'sidebar.section.create', 'sidebar.move', 'group.create', 'agent.appearance.update', 'routines.manage'}


def objects(value):
    if isinstance(value, str):
        try: yield from objects(json.loads(value))
        except (ValueError, TypeError): return
    elif isinstance(value, dict):
        yield value
        for child in value.values(): yield from objects(child)
    elif isinstance(value, list):
        for child in value: yield from objects(child)


class Model(BaseModel):
    schema_seen = False
    queued = None
    errors = []
    calls = 0
    evidence = []
    operation = str(uuid.uuid4())
    def log_message(self, *_args): pass
    def do_POST(self):
        raw = self.rfile.read(int(self.headers['Content-Length']))
        data = json.loads(raw)
        latest_user = next((m for m in reversed(data.get('messages',[])) if m.get('role')=='user'),{})
        Model.evidence.append({'path':self.path,'tools':[t.get('function',{}).get('name') for t in data.get('tools',[])], 'latest':str(latest_user.get('content'))[:160], 'tool_results':[str(m.get('content'))[:1500] for m in data.get('messages',[]) if m.get('role')=='tool'][-2:]})
        if 'nativemanagement:' not in str(latest_user.get('content')):
            self.rfile = io.BytesIO(raw)
            return super().do_POST()
        Model.calls += 1
        tools = {t['function']['name']: t['function'] for t in data.get('tools', [])}
        results = [m.get('content') for m in data.get('messages', []) if m.get('role') == 'tool']
        schema = tools.get('workspace_agents') or next((o['tools']['workspace_agents'] for o in objects(results) if isinstance(o.get('tools'), dict) and isinstance(o['tools'].get('workspace_agents'), dict)), None)
        if schema:
            Model.schema_seen = REQUIRED <= set(schema.get('parameters', {}).get('properties', {}).get('action', {}).get('enum', []))
        described = next((o for o in reversed(list(objects(results))) if 'target_id' in o and 'appearance' in o and 'context' in o), None)
        queued = next((o for o in objects(results) if o.get('operation_id') == Model.operation and o.get('state') == 'queued'), None)
        if queued:
            Model.queued = queued
            message, finish = {'role': 'assistant', 'content': 'Avatar change queued.'}, 'stop'
        else:
            if not Model.schema_seen:
                name, arguments = 'tool_describe', {'names': ['workspace_agents']}
            elif not described:
                name, arguments = 'workspace_agents', {'action': 'describe', 'spec': {}}
            else:
                context = json.loads(described['context'].split('\n', 1)[1])
                name, arguments = 'workspace_agents', {'action': 'agent.appearance.update', 'spec': {
                    'operation_id': Model.operation, 'profile': 'alpha', 'id': described['target_id'],
                    'expected_revision': context['workspace_revision'],
                    'appearance': {'kind': 'shape', 'shape': 'kite', 'color': 'clay'}, 'photo': None}}
            if name not in tools and 'tool_call' in tools:
                nested = {'name': name, 'arguments': arguments}
                arguments = {'calls': [nested]} if 'calls' in tools['tool_call'].get('parameters', {}).get('properties', {}) else nested
                name = 'tool_call'
            if name not in tools:
                Model.errors.append('Required native discovery bridge unavailable')
            message, finish = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'management-' + str(Model.calls),
                'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}]}, 'tool_calls'
        output = {'id': 'synthetic-management', 'object': 'chat.completion', 'created': int(time.time()), 'model': 'fixture-model',
            'choices': [{'index': 0, 'message': message, 'finish_reason': finish}],
            'usage': {'prompt_tokens': 100, 'completion_tokens': 10, 'total_tokens': 110}}
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream' if data.get('stream') else 'application/json')
        self.end_headers()
        if data.get('stream'):
            delta = {'role': 'assistant', 'content': message.get('content')}
            if finish == 'tool_calls': delta = {'role': 'assistant', 'tool_calls': [{'index': 0, **message['tool_calls'][0]}]}
            for chunk, reason in [(delta, None), ({}, finish)]:
                self.wfile.write(('data: ' + json.dumps({**output, 'object': 'chat.completion.chunk', 'choices': [{'index': 0, 'delta': chunk, 'finish_reason': reason}]}) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
        else: self.wfile.write(json.dumps(output).encode())


async def exercise(root, home, port):
    seed(home, port)
    try: import hermes_yaml as yaml
    except ImportError: import yaml
    for config in (home / 'config.yaml', home / 'profiles/alpha/config.yaml'):
        saved = yaml.safe_load(config.read_text())
        saved['agent']['max_turns'] = 7
        saved['platform_toolsets'] = {'cli': ['terminal']}
        saved['tools'] = {'tool_search': {'listing': 'off'}}
        config.write_text(yaml.safe_dump(saved))
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations
    from bot_web.workspace import WorkspaceStore, WorkspaceService, workspace_path
    from bot_web.agent_management import drain, receipts, submit
    from bot_web.organization import agent_edit
    from bot_web.payload import copy_payload
    from hermes_cli.profiles import get_profile_dir
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
    copy_payload(root / 'plugins/bot-web', home / 'plugins/bot-web')
    assert dashboard_set_agent_plugin_enabled('bot-web', enabled=True).get('ok') is True
    gateway = NativeGateway(); await gateway.start()
    store = WorkspaceStore(workspace_path())
    try:
        service = WorkspaceService(BotOperations(gateway), store)
        await service.invoke('workspace.detect_primary', {})
        state = store.read()
        await service.invoke('workspace.initialize', {'profile': 'default', 'handle': 'hermes', 'appearance': {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}, 'photo': None, 'expected_revision': state['revision']})
        from PIL import Image
        photo = io.BytesIO()
        Image.new('RGBA', (1200, 800), (46, 102, 110, 160)).save(photo, format='PNG')
        source_photo = 'data:image/png;base64,' + base64.b64encode(photo.getvalue()).decode()
        asset = {'name': 'default', 'asset': 'avatar'}
        assert (await gateway.call('profiles.set_asset', {**asset, 'data': source_photo}))['ok']
        thumbnail = (await service.invoke('bots.appearance.get', {'profile': 'default'}))['data']
        with Image.open(io.BytesIO(base64.b64decode(thumbnail.split(',', 1)[1]))) as image:
            assert image.size == (256, 256) and image.mode == 'RGBA'
            assert image.getpixel((128, 128))[3] == 160 and image.info == {}
        assert (await gateway.call('profiles.get_asset', asset))['data'] == source_photo
        await gateway.call('bot_web.runtime.prepare', {'profile':'alpha'})
        await service.invoke('workspace.set_orchestrator', {'profile':'alpha','expected_revision':store.read()['revision']})
        souls = {p: (Path(get_profile_dir(p)) / 'SOUL.md').read_bytes() if (Path(get_profile_dir(p)) / 'SOUL.md').exists() else None for p in ('alpha', 'beta')}
        roles = {p: deepcopy(store.read()['bots'][p]['role']) for p in ('alpha', 'beta')}
        sid = (await service.ops.invoke('bot.open', {'profile': 'alpha'}))['session_id']
        native_catalog = await gateway.call('tools.show', {'session_id':sid})
        assert any(t['name']=='workspace_agents' for section in native_catalog['sections'] for t in section['tools']), 'Workspace tools were not registered'
        events = asyncio.Queue(maxsize=256); gateway.listeners.add(events)
        await service.ops.invoke('chat.send', {'session_id': sid, 'text': 'nativemanagement: Please change your avatar to the clay kite.'})
        async with asyncio.timeout(90):
            while True:
                event = await events.get()
                if event.get('session_id') == sid and event.get('type') == 'message.complete': break
        assert Model.schema_seen and Model.queued and not Model.errors, {'schema_seen': Model.schema_seen, 'queued': Model.queued, 'errors': Model.errors, 'calls':Model.calls,'evidence':Model.evidence[-8:], 'completion':event.get('payload')}
        await drain(service)
        assert receipts(store, 'alpha')[0]['state'] == 'applied', receipts(store, 'alpha')
        state = store.read()
        assert state['bots']['alpha']['appearance'] == {'kind': 'shape', 'shape': 'kite', 'color': 'clay'}
        native_profiles = (await gateway.call('profiles.list', {}))['profiles']
        alpha = next(p for p in native_profiles if p['name'] == 'alpha')
        assert alpha['ui_meta']['hermes-bots']['workspaceAppearance'] == state['bots']['alpha']['appearance']
        turns = Model.calls + BaseModel.turns
        beta = store.read()['bots']['beta']
        submit(store, 'alpha', 'agent.appearance.update', {'operation_id':str(uuid.uuid4()),'profile':'beta','id':beta['id'],'expected_revision':store.read()['revision'],'appearance':{'kind':'shape','shape':'petal','color':'moss'},'photo':None})
        await drain(service)
        assert receipts(store,'alpha')[0]['state']=='applied'
        native_profiles=(await gateway.call('profiles.list',{}))['profiles']
        assert next(p for p in native_profiles if p['name']=='beta')['ui_meta']['hermes-bots']['workspaceAppearance']=={'kind':'shape','shape':'petal','color':'moss'}
        layout = agent_edit(store, 'beta', 'sidebar.describe', {})
        created = agent_edit(store, 'beta', 'sidebar.section.create', {'operation_id': str(uuid.uuid4()), 'expected_revision': layout['revision'], 'name': 'Research'})
        row = next(i for s in created['sections'] for i in s['items'] if i['kind'] == 'pebble' and i['id'] == state['bots']['beta']['id'])
        moved = agent_edit(store, 'alpha', 'sidebar.move', {'operation_id': str(uuid.uuid4()), 'expected_revision': created['revision'], 'placement_id': row['placementId'], 'section_id': created['sections'][-1]['id'], 'before_id': None})
        assert moved['sections'][-1]['items'] == [row]
        group_params = {'room_id': 'explicit-native-group', 'name': 'Topic discussion', 'profiles': ['alpha', 'beta']}
        first = await service.invoke('room.create', group_params)
        assert first['state'] == 'ready', first
        assert await service.invoke('room.create', group_params) == first
        native_before = await gateway.call('groups.state', {'room_id': first['room']['room_id']})
        snapshot = await service.invoke('workspace.snapshot', {})
        assert any(i['kind'] == 'group' and i['readKey'] == first['room']['read_key'] for s in snapshot['organization']['sections'] for i in s['items'])
        assert (await gateway.call('groups.state', {'room_id': first['room']['room_id']}))['room'] == native_before['room']
        group_operation = str(uuid.uuid4())
        state = store.read()
        group_spec = {'operation_id': group_operation, 'name': 'Agent-started discussion',
            'expected_revision': state['revision'], 'members': [state['bots'][p]['id'] for p in ('alpha', 'beta')]}
        assert submit(store, 'beta', 'group.create', group_spec)['state'] == 'queued'
        await drain(service)
        group_receipt = receipts(store, 'beta')[0]
        assert group_receipt['state'] == 'applied', group_receipt
        assert group_receipt == submit(store, 'beta', 'group.create', group_spec)
        agent_group = group_receipt['result']['room']
        log = await gateway.call('groups.log', {'room_id': agent_group['room_id'], 'since_seq': 0})
        assert not any(row['kind'] == 'message.user' for row in log['events']), 'Agent group creation must never impersonate owner input'
        command = {'action': 'create', 'name': 'Acceptance future routine', 'prompt': 'Send a concise summary to my existing Bot Chat.', 'schedule': '2099-12-01T09:00:00'}
        target = store.read()['bots']['beta']
        submit(store, 'alpha', 'routines.manage', {'operation_id': str(uuid.uuid4()), 'profile': 'beta', 'id': target['id'], 'expected_revision': store.read()['revision'], 'command': command})
        await drain(service)
        assert receipts(store, 'alpha')[0]['state'] == 'applied', receipts(store, 'alpha')
        jobs = await gateway.call('bot_web.routines', {'profile': 'beta', 'command': {'action': 'list'}})
        assert jobs['success'] and len(jobs['jobs']) == 1, jobs
        job = jobs['jobs'][0]; ident = job['job_id']
        for action in ('update', 'pause', 'resume', 'remove'):
            job = (await gateway.call('bot_web.routines', {'profile': 'beta', 'command': {'action': 'list'}}))['jobs'][0]
            change = {'action': action, 'job_id': ident, 'expected': job['revision']}
            if action == 'update': change.update(name='Updated future routine', prompt='Keep this acceptance local.', schedule='2099-12-02T09:00:00')
            result = await gateway.call('bot_web.routines', {'profile': 'beta', 'command': change})
            assert result['success'], result
        assert (await gateway.call('bot_web.routines', {'profile': 'beta', 'command': {'action': 'list'}}))['jobs'] == []
        notifications=[]
        while not events.empty(): notifications.append(events.get_nowait())
        assert any(e.get('type')=='routines.changed' and e.get('payload',{}).get('profile')=='beta' for e in notifications)
        assert Model.calls + BaseModel.turns == turns, 'Layout, native groups and cron configuration must not invoke models'
        for profile in ('alpha', 'beta'):
            path = Path(get_profile_dir(profile)) / 'SOUL.md'
            assert (path.read_bytes() if path.exists() else None) == souls[profile]
            assert store.read()['bots'][profile]['role'] == roles[profile]
        print(json.dumps({'revision': gateway.build['revision'], 'actual_deferred_tool_schema': sorted(REQUIRED),
            'native_avatar_metadata': True, 'photo_thumbnail_preserves_native_original': True,
            'section_move_without_native_membership_change': True,
            'group_identity_and_retry': True, 'native_routine_management': True,
            'models': 'deterministic localhost discovery/owner turn only'}))
    finally:
        store.db.close(); await gateway.stop()


def main():
    root = Path(__file__).resolve().parents[2]
    native_root = Path(next(iter(find_spec('tui_gateway').submodule_search_locations))).resolve().parent
    with tempfile.TemporaryDirectory(prefix='pebble-native-management-') as directory:
        home = Path(directory) / 'home'; home.mkdir()
        os.environ.clear()
        os.environ.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory) / 'runtime'), PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin', HERMES_NO_AUTO_INSTALL='1', PYTHONUNBUFFERED='1', NO_PROXY='127.0.0.1,localhost', PYTHONPATH=str(native_root))
        os.environ.update(isolated_user_environment(directory))
        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        load_plugin(root)
        try: asyncio.run(exercise(root, home, model.server_port))
        finally: model.shutdown(); model.server_close()


if __name__ == '__main__': main()
