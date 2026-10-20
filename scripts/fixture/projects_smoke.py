"""Native project/task acceptance in a disposable home. No model turns or workers."""
import asyncio
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import uuid
from unittest.mock import patch

from native_smoke import load_plugin, isolated_user_environment

ROOT = Path(__file__).resolve().parents[2]


async def verify(home):
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations, InvalidOperation
    from bot_web.workspace import WorkspaceStore, WorkspaceService
    from bot_web.work import WorkService
    from bot_web.work_native import NativeWork, CheckedConnection, task_revision
    native = NativeGateway()
    await native.start()
    store = WorkspaceStore(home / 'bot-web/workspace.sqlite')
    workspace = WorkspaceService(BotOperations(native), store)
    try:
        primary = await workspace.invoke('workspace.detect_primary', {})
        await workspace.invoke('workspace.initialize', {'profile': primary['profile'], 'handle': 'aurora',
            'appearance': {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}, 'photo': None,
            'expected_revision': primary['revision']})
        await native.call('profiles.create', {'name': 'researcher', 'no_skills': True})
        await workspace.invoke('agent.enable', {'profile': 'researcher', 'initialize_chat': True})
        service = WorkService(store, home / 'bot-web/work.sqlite')
        def invoke(operation, params):
            return service.invoke(operation, params)
        catalog = invoke('work.describe', {})
        scope = {'workspace_id': catalog['workspace_id']}
        projects = []
        for name in ['Research', 'Website']:
            request = {**scope, 'operation_id': str(uuid.uuid4()), 'name': name, 'description': 'A folderless native project.'}
            receipt = await native.call('bot_web.work', {'operation': 'work.project.create', 'params': request})
            assert receipt['ok'], receipt
            created = receipt['value']
            assert created == invoke('work.project.create', request)
            projects.append(created)
        assert projects[0]['board'] != projects[1]['board']
        project = next(b for b in invoke('work.describe', {})['boards'] if b['slug'] == projects[0]['board'])
        edit_project = {**scope, 'operation_id': str(uuid.uuid4()), 'project_id': project['project_id'],
            'expected_revision': project['revision'], 'name': 'Research sources', 'description': 'Use original sources.'}
        assert invoke('work.project.update', edit_project)['state'] == 'completed'
        try:
            invoke('work.project.update', {**edit_project, 'operation_id': str(uuid.uuid4()), 'name': 'Stale name'})
            raise AssertionError('Stale project instructions overwritten')
        except InvalidOperation as error:
            assert error.code == 'STALE_REVISION'
        # Exercise the actual native middleware chain and tool implementation.
        from hermes_cli.plugins import discover_plugins, has_middleware
        from hermes_cli.middleware import run_tool_execution_middleware
        from tools.kanban_tools import _handle_create
        from hermes_cli import kanban_db
        discover_plugins()
        assert has_middleware('tool_execution')
        pointer = kanban_db.get_current_board()
        other_project = projects[1]['project_id']
        args = {'title': 'Rejected mismatch', 'board': projects[0]['board'], 'project': other_project,
            'assignee': 'researcher', 'triage': True}
        def create_tool(arguments):
            return run_tool_execution_middleware('kanban_create', arguments, _handle_create)
        assert 'error' in json.loads(create_tool(args))
        assert 'error' in json.loads(create_tool({**args, 'board': 'default'}))
        inherited = json.loads(create_tool({k: v for k, v in args.items() if k != 'project'}))
        assert inherited.get('ok'), inherited
        assert kanban_db.get_current_board() == pointer, 'Plugin changed the native current board'
        create = {**scope, 'operation_id': str(uuid.uuid4()), 'board': projects[0]['board'],
            'title': 'Verify three sources', 'body': '- [ ] Compare sources\n- [ ] Report findings',
            'assignee': 'researcher', 'priority': 1}
        receipt = invoke('work.task.create', create)
        assert receipt == invoke('work.task.create', create)
        detail = invoke('work.task', {**scope, 'board': receipt['board'], 'id': receipt['task_id']})
        assert detail['task']['status'] == 'triage'
        assert detail['task']['project_id'] == projects[0]['project_id']
        assert invoke('work.board', {**scope, 'board': projects[1]['board']})['columns']
        saved_tasks = [t for c in invoke('work.board', {**scope, 'board': receipt['board']})['columns'] for t in c['tasks']]
        assert sum(t['id'] == receipt['task_id'] for t in saved_tasks) == 1
        assert len(saved_tasks) == 2 and all(t['project_id'] == projects[0]['project_id'] for t in saved_tasks)
        comment = {**scope, 'operation_id': str(uuid.uuid4()), 'board': receipt['board'], 'id': receipt['task_id'], 'body': 'Check the original publication.'}
        invoke('work.task.comment', comment)
        invoke('work.task.comment', comment)
        assert len(invoke('work.task', {**scope, 'board': receipt['board'], 'id': receipt['task_id']})['comments']) == 1
        # A worker's physical native DB fence wins over a forged board argument.
        pinned_database = str(kanban_db.kanban_db_path(projects[0]['board']))
        with patch.dict(os.environ, {'HERMES_KANBAN_TASK': receipt['task_id'],
                'HERMES_KANBAN_DB': pinned_database, 'HERMES_KANBAN_BOARD': projects[0]['board']}):
            forged = {**args, 'title': 'Pinned child task', 'board': projects[1]['board']}
            assert 'error' in json.loads(create_tool(forged))
            result = json.loads(create_tool({k: v for k, v in forged.items() if k != 'project'}))
            assert result.get('ok'), result
        assert kanban_db.get_current_board() == pointer
        if catalog['capabilities']['edit_details']:
            update = {**create, 'operation_id': str(uuid.uuid4()), 'id': receipt['task_id'],
                'title': 'Verify four sources', 'expected_revision': detail['task']['revision']}
            invoke('work.task.update', update)
            state = store.read()
            state['bots']['researcher']['available'] = False
            store.save(state, state['revision'])
            historical = invoke('work.task', {**scope, 'board': receipt['board'], 'id': receipt['task_id']})['task']
            invoke('work.task.update', {**update, 'operation_id': str(uuid.uuid4()),
                'expected_revision': historical['revision'], 'title': 'Keep historical assignment'})
            state = store.read()
            state['bots']['researcher']['available'] = True
            store.save(state, state['revision'])
            try:
                invoke('work.task.update', {**update, 'operation_id': str(uuid.uuid4()), 'title': 'Stale overwrite'})
                raise AssertionError('Stale update accepted')
            except InvalidOperation as error:
                assert error.code == 'STALE_REVISION'
            adapter = NativeWork(primary['profile'])
            with adapter.scoped(), closing(adapter.api._conn(board=receipt['board'])) as conn:
                before = adapter.task(receipt['board'], receipt['task_id'])['task']
                adapter.api.update_task(receipt['task_id'], adapter.api.UpdateTaskBody(title='Native CLI edit'), board=receipt['board'])
                try:
                    adapter.kanban.edit_task(CheckedConnection(conn, receipt['task_id'], task_revision(before)), receipt['task_id'], title='Unsafe overwrite', board=receipt['board'])
                    raise AssertionError('Native concurrent edit was overwritten')
                except InvalidOperation as error:
                    assert error.code == 'STALE_REVISION'
                assert adapter.task(receipt['board'], receipt['task_id'])['task']['title'] == 'Native CLI edit'
        # Recover each committed native boundary before its receipt advances.
        for step in ('create_project', 'create_board', 'link_project'):
            partial = {**scope, 'operation_id': str(uuid.uuid4()), 'name': 'Resume '+step, 'description': ''}
            original = getattr(NativeWork, step)
            def interrupted(self, *args):
                original(self, *args)
                raise RuntimeError('Synthetic interruption after '+step)
            with patch.object(NativeWork, step, interrupted):
                try:
                    invoke('work.project.create', partial)
                    raise AssertionError('Interruption not exercised')
                except RuntimeError:
                    pass
            recovered = invoke('work.project.create', partial)
            assert recovered['state'] == 'completed'
        assert len(invoke('work.describe', {})['boards']) == 6
        # The catalog stays with its original identity after Main Pebble transfer.
        state = store.read()
        state['orchestrator'] = 'researcher'
        state['bots']['researcher']['manager'] = None
        store.save(state, state['revision'])
        assert len(invoke('work.describe', {})['boards']) == 6
        listed = await native.call('projects.list', {'profile': primary['profile']})
        assert len(listed['projects']) == 5
        other = await native.call('projects.list', {'profile': 'researcher'})
        assert len(other['projects']) == 0
        adapter = NativeWork(primary['profile'])
        with adapter.scoped():
            for project in projects:
                board = adapter.board(project['board'])
                for column in board['columns']:
                    for task in column['tasks']:
                        assert task['status'] == 'triage'
                        assert adapter.task(project['board'], task['id'])['runs'] == []
        service.close()
        print(json.dumps({'ok': True, 'isolated_home': True, 'native_rpc_and_services': True,
            'edit_details': catalog['capabilities']['edit_details'], 'separate_projects': 5,
            'idempotent_task_and_comment': True, 'partial_project_recovered': ['project', 'board', 'link'],
            'catalog_survives_main_transfer': True, 'native_project_policy_and_worker_fence': True,
            'workers': 0, 'model_turns': 0}))
    finally:
        store.db.close()
        await native.stop()


def main():
    with tempfile.TemporaryDirectory(prefix='pebble-native-projects-') as directory:
        home = Path(directory) / '.hermes'
        home.mkdir()
        os.environ.clear()
        os.environ.update(PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin',
            HERMES_RUNTIME_DIR=str(Path(directory) / 'runtime'), HERMES_NO_AUTO_INSTALL='1',
            NO_PROXY='127.0.0.1,localhost', PYTHONDONTWRITEBYTECODE='1')
        os.environ.update(isolated_user_environment(directory))
        os.environ['HERMES_HOME'] = str(home)
        os.environ['HERMES_KANBAN_HOME'] = str(home)
        os.environ['HERMES_SINGLE_QUERY_SESSION'] = ''
        os.environ['HERMES_TOOL_CALL_LOG'] = 'off'
        (home / 'config.yaml').write_text('auth:\n  adopt_external_logins: false\nmodel:\n  default: synthetic-local\nagent:\n  bot_mode_protocol: true\nplugins:\n  enabled: [bot-web]\n  entries:\n    bot-web:\n      enabled: true\n')
        plugin = home / 'plugins/bot-web'
        plugin.parent.mkdir()
        import runpy
        payload = runpy.run_path(str(ROOT / 'plugins/bot-web/payload.py'))
        payload['copy_payload'](ROOT / 'plugins/bot-web', plugin)
        load_plugin(ROOT)
        asyncio.run(verify(home))


if __name__ == '__main__':
    main()
