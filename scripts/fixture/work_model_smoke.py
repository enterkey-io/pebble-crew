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
    worker_step = 0
    worker_guided = False
    worker_completed = False
    owner_notified = False
    project_operation = str(uuid.uuid4())
    task_operation = str(uuid.uuid4())

    def do_POST(self):
        payload = self.rfile.read(int(self.headers['Content-Length']))
        data = json.loads(payload)
        user = str(next((m.get('content') for m in reversed(data.get('messages', [])) if m.get('role') == 'user'), ''))
        if user.startswith('work kanban task '):
            step = WorkModel.worker_step
            tools = ['kanban_show', 'kanban_comment', 'kanban_complete']
            name = tools[step] if step < len(tools) else None
            if name:
                assert 'Pebble Crew task reporting:' in json.dumps(data['messages']), 'Worker did not receive the reporting protocol'
                WorkModel.worker_guided = True
            task_id = user.split('work kanban task ', 1)[1].split()[0]
            args = [{'task_id': task_id}, {'task_id': task_id, 'body': 'I will prepare the requested greeting and record the result.'},
                {'task_id': task_id, 'summary': 'Hello! This is the greeting you requested.', 'result': 'Hello! This is the greeting you requested.'}][step] if name else None
            names = {t['function']['name'] for t in data.get('tools', [])}
            if name and name not in names and not any('kanban_complete' in json.dumps(m.get('content')) for m in data['messages'] if m.get('role') == 'tool'):
                return self.respond(data, 'tool_describe', {'names': tools}, None)
            if name and name not in names:
                wrapper = next(t['function'] for t in data['tools'] if t['function']['name'] == 'tool_call')
                nested = {'name': name, 'arguments': args}
                args = {'calls': [nested]} if 'calls' in wrapper['parameters']['properties'] else nested
                name = 'tool_call'
            WorkModel.worker_step += 1
            if not name: WorkModel.worker_completed = True
            return self.respond(data, name, args, None if name else 'The greeting is recorded in the completed task.')
        if 'A Hermes task worker has reported an outcome' in user:
            WorkModel.owner_notified = True
            return self.respond(data, None, None, 'Hello! This is the greeting you requested.')
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
        self.respond(data, name, arguments, reply)

    def respond(self, data, name, arguments, reply):
        message = {'role': 'assistant', 'content': reply} if reply else {
            'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'work-'+str(WorkModel.step)+'-'+str(WorkModel.worker_step), 'type': 'function',
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
        # A real comment mention wakes the existing canonical native conversation once.
        from bot_web.work_delivery import deliver
        work = WorkService(store, workspace_path().with_name('work.sqlite'))
        try:
            operation = { 'workspace_id': catalog['workspace_id'], 'operation_id': str(uuid.uuid4()),
                'board': project['slug'], 'id': tasks[0]['id'], 'body': '@aurora verify the original sources.' }
            work.invoke('work.task.comment', operation)
            work.invoke('work.task.comment', operation)
            before = Model.turns
            await deliver(workspace, gateway)
            async with asyncio.timeout(60):
                while True:
                    event = await events.get()
                    if event.get('session_id') == sid and event['type'] == 'message.complete':
                        assert event.get('payload', {}).get('status') != 'error'
                        break
            assert Model.turns == before + 1, 'Mention did not produce exactly one native reply'
            await deliver(workspace, gateway)
            await asyncio.sleep(.2)
            assert Model.turns == before + 1, 'Mention retried a confirmed wake'
            view = work.invoke('work.task', {'workspace_id': catalog['workspace_id'], 'board': project['slug'], 'id': tasks[0]['id']})
            assert len(view['mentions']) == 1 and view['mentions'][0]['state'] == 'sent', view['mentions']
        finally:
            work.close()
        # Run a genuine dispatcher-owned CLI worker, then deliver its native outcome
        # into the already existing Bot Chat. The only provider is this loopback model.
        work = WorkService(store, workspace_path().with_name('work.sqlite'))
        worker_pid = None
        try:
            greeting = work.invoke('work.task.create', {'workspace_id': catalog['workspace_id'],
                'operation_id': str(uuid.uuid4()), 'board': project['slug'], 'title': 'Message me hello',
                'body': 'Message me hello, then mark this task done.', 'assignee': 'default', 'priority': 0, 'status': 'todo'})
            ref = {'workspace_id': catalog['workspace_id'], 'board': project['slug'], 'id': greeting['task_id']}
            adapter = NativeWork('default')
            with adapter.scoped():
                adapter.dispatch(project['slug'])
                worker_pid = adapter.task(project['slug'], greeting['task_id'])['task'].get('worker_pid')
            async with asyncio.timeout(90):
                while True:
                    outcome = work.invoke('work.task', ref)
                    if outcome['task']['status'] in ('done', 'blocked'): break
                    await asyncio.sleep(.2)
            assert outcome['task']['status'] == 'done', outcome
            assert WorkModel.worker_guided and WorkModel.worker_step >= 3
            assert outcome['comments'] and outcome['runs'], outcome
            assert any(event['kind'] == 'completed' for event in outcome['events'])
            await deliver(workspace, gateway)
            async with asyncio.timeout(60):
                while True:
                    event = await events.get()
                    if event.get('session_id') == sid and event['type'] == 'message.complete': break
            assert WorkModel.owner_notified
            transcript = await ops.invoke('chat.history', {'session_id': sid})
            assert 'Hello! This is the greeting you requested.' in json.dumps(transcript)
            notices = list(work.store.db.execute('SELECT state FROM task_notifications'))
            assert notices == [('sent',)], notices
            await deliver(workspace, gateway)
            assert list(work.store.db.execute('SELECT state FROM task_notifications')) == notices
        finally:
            if worker_pid:
                import psutil
                try:
                    child = psutil.Process(worker_pid)
                    if greeting['task_id'] in ' '.join(child.cmdline()):
                        child.wait(timeout=5)
                except psutil.TimeoutExpired:
                    child.terminate()
                    child.wait(timeout=5)
                except psutil.NoSuchProcess:
                    pass
            work.close()
        assert soul.read_bytes() == original
        print(json.dumps({'revision': gateway.build['revision'], 'deferred_work_schema': True,
            'saved_tool_selection': True, 'native_model_project_and_task': True, 'real_dispatcher_worker': True, 'worker_reporting_protocol': True, 'native_history': True, 'result_delivered_to_existing_bot_chat_once': True,
            'model': 'deterministic-local-only', 'persona_preserved': True, 'mention_woke_existing_bot_once': True}))
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
