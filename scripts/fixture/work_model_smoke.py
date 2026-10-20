"""Deferred native work-tool acceptance; isolated home and deterministic local model."""
import asyncio
import io
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import uuid

from native_smoke import Model, load_plugin, seed, isolated_user_environment


def records(value):
    if isinstance(value, str):
        try:
            yield from records(json.loads(value))
        except (ValueError, TypeError):
            pass
    elif isinstance(value, dict):
        yield value
        for item in value.values():
            yield from records(item)
    elif isinstance(value, list):
        for item in value:
            yield from records(item)


class WorkModel(Model):
    step = 0
    completed = False
    discovered = False
    failure = None
    project_operation = str(uuid.uuid4())
    task_operation = str(uuid.uuid4())

    def do_POST(self):
        payload = self.rfile.read(int(self.headers['Content-Length']))
        data = json.loads(payload)
        user = str(next((m.get('content') for m in reversed(data.get('messages', [])) if m.get('role') == 'user'), ''))
        if 'Synthetic native project management' not in user:
            self.rfile = io.BytesIO(payload)
            return super().do_POST()
        names = {tool['function']['name'] for tool in data.get('tools', [])}
        history = [message.get('content') for message in data.get('messages', []) if message.get('role') == 'tool']
        values = list(records(history))
        step = WorkModel.step
        WorkModel.step += 1
        name, arguments, reply = 'workspace_work', None, None
        errors = [v['error'] for v in values if 'error' in v]
        if errors:
            WorkModel.failure = errors[-1]
            reply = 'The native work tool failed.'
        elif step == 0:
            assert 'tool_describe' in names, 'Deferred discovery unavailable with saved tool selection'
            assert 'workspace_work' not in names, 'Expected the real deferred tool path'
            name, arguments = 'tool_describe', {'names': ['workspace_work']}
        elif step == 1:
            assert any(isinstance(v.get('tools'), dict) and 'workspace_work' in v['tools'] and 'work.project.create' in json.dumps(v) for v in values), 'Work schema never received'
            WorkModel.discovered = True
            arguments = {'operation': 'work.describe', 'params': {}}
        else:
            catalog = next(v for v in values if 'workspace_id' in v and 'boards' in v)
            scope = {'workspace_id': catalog['workspace_id']}
            if step == 2:
                arguments = {'operation': 'work.project.create', 'params': {**scope,
                    'operation_id': self.project_operation, 'name': 'Native model project', 'description': 'Verify original sources.'}}
            elif step == 3:
                project = next(v for v in values if v.get('id') == self.project_operation and v.get('state') == 'completed')
                arguments = {'operation': 'work.task.create', 'params': {**scope,
                    'operation_id': self.task_operation, 'board': project['board'], 'title': 'Read the originals',
                    'body': '- [ ] Record source links', 'assignee': 'default', 'priority': 0}}
            elif step == 4:
                task = next(v for v in values if v.get('id') == self.task_operation and v.get('state') == 'completed')
                arguments = {'operation': 'work.task', 'params': {**scope, 'board': task['board'], 'id': task['task_id']}}
            else:
                task = next(v['task'] for v in values if isinstance(v.get('task'), dict) and v['task'].get('title') == 'Read the originals')
                assert task['status'] == 'triage' and task['project_id']
                WorkModel.completed = True
                reply = 'Native project and its triage task confirmed.'
        if not reply and name not in names:
            wrapper = next(t['function'] for t in data['tools'] if t['function']['name'] == 'tool_call')
            nested = {'name': name, 'arguments': arguments}
            arguments = {'calls': [nested]} if 'calls' in wrapper['parameters']['properties'] else nested
            name = 'tool_call'
        message = {'role': 'assistant', 'content': reply} if reply else {
            'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'work-'+str(step), 'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(arguments)}}]}
        reason = 'stop' if reply else 'tool_calls'
        response = {'created': int(time.time()), 'id': 'work-proof', 'object': 'chat.completion', 'model': 'fixture-model',
            'choices': [{'index': 0, 'message': message, 'finish_reason': reason}],
            'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream' if data.get('stream') else 'application/json')
        self.end_headers()
        if data.get('stream'):
            delta = message if reply else {'role': 'assistant', 'tool_calls': [{'index': 0, **message['tool_calls'][0]}]}
            for part, finish in [(delta, None), ({}, reason)]:
                chunk = {**response, 'object': 'chat.completion.chunk', 'choices': [{'index': 0, 'delta': part, 'finish_reason': finish}]}
                self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
        else:
            self.wfile.write(json.dumps(response).encode())


async def exercise(root, home, port):
    seed(home, port)
    import yaml
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations
    from bot_web.workspace import WorkspaceStore, WorkspaceService, workspace_path
    from bot_web.payload import copy_payload
    from bot_web.work import WorkService
    from bot_web.work_native import NativeWork
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
    config = yaml.safe_load((home / 'config.yaml').read_text())
    config['platform_toolsets'] = {'cli': ['terminal']}
    config['tools'] = {'tool_search': {'listing': 'off'}}
    config['agent'].update(max_turns=10, coding_context='off')
    (home / 'config.yaml').write_text(yaml.safe_dump(config))
    soul = home / 'SOUL.md'
    soul.write_text('SYNTHETIC_WORK_PERSONALITY: preserve this identity.\n')
    original = soul.read_bytes()
    copy_payload(root / 'plugins/bot-web', home / 'plugins/bot-web')
    assert dashboard_set_agent_plugin_enabled('bot-web', enabled=True).get('ok')
    gateway = NativeGateway()
    await gateway.start()
    store = WorkspaceStore(workspace_path())
    try:
        ops = BotOperations(gateway)
        workspace = WorkspaceService(ops, store)
        primary = await workspace.invoke('workspace.detect_primary', {})
        await workspace.invoke('workspace.initialize', {'profile': primary['profile'], 'handle': 'aurora',
            'appearance': {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}, 'photo': None,
            'expected_revision': primary['revision']})
        sid = (await ops.invoke('bot.open', {'profile': primary['profile']}))['session_id']
        events = asyncio.Queue(maxsize=256)
        gateway.listeners.add(events)
        await ops.invoke('chat.send', {'session_id': sid, 'text': 'Synthetic native project management'})
        async with asyncio.timeout(60):
            while True:
                event = await events.get()
                if event.get('session_id') == sid and event['type'] == 'message.complete':
                    assert event.get('payload', {}).get('status') != 'error', event
                    break
        assert WorkModel.completed and WorkModel.discovered, WorkModel.failure
        work = WorkService(store, workspace_path().with_name('work.sqlite'))
        try:
            catalog = work.invoke('work.describe', {})
            project = next(b for b in catalog['boards'] if b['name'] == 'Native model project')
            view = work.invoke('work.board', {'workspace_id': catalog['workspace_id'], 'board': project['slug']})
            tasks = [task for column in view['columns'] for task in column['tasks']]
            assert len(tasks) == 1 and tasks[0]['status'] == 'triage'
            adapter = NativeWork(primary['profile'])
            with adapter.scoped():
                assert adapter.task(project['slug'], tasks[0]['id'])['runs'] == []
        finally:
            work.close()
        assert soul.read_bytes() == original
        print(json.dumps({'revision': gateway.build['revision'], 'deferred_work_schema': True,
            'saved_tool_selection': True, 'native_model_project_and_task': True, 'workers': 0,
            'model': 'deterministic-local-only', 'persona_preserved': True}))
    finally:
        store.db.close()
        await gateway.stop()


def main():
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='pebble-native-work-model-') as directory:
        home = Path(directory) / 'home'
        home.mkdir()
        os.environ.clear()
        os.environ.update(HERMES_HOME=str(home), HERMES_KANBAN_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory)/'runtime'),
            PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin', HERMES_NO_AUTO_INSTALL='1', PYTHONUNBUFFERED='1', NO_PROXY='127.0.0.1,localhost')
        os.environ.update(isolated_user_environment(directory))
        model = ThreadingHTTPServer(('127.0.0.1', 0), WorkModel)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        load_plugin(root)
        try:
            asyncio.run(exercise(root, home, model.server_port))
        finally:
            model.shutdown()


if __name__ == '__main__':
    main()
