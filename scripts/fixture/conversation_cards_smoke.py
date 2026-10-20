"""Real native questions and Main notification; disposable home, loopback model only."""
import asyncio
from http.server import ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading

from native_smoke import seed, load_plugin, isolated_user_environment
from work_model_smoke import WorkModel


class CardModel(WorkModel):
    asked = False
    answered = False
    notified = 0
    question_turns = []

    def do_POST(self):
        payload = self.rfile.read(int(self.headers['Content-Length']))
        data = json.loads(payload)
        user = str(next((m.get('content') for m in reversed(data.get('messages', [])) if m.get('role') == 'user'), ''))
        if 'Synthetic native questions' in user:
            CardModel.question_turns.append({'tools': [t['function']['name'] for t in data.get('tools', [])],
                'results': [m.get('content') for m in data.get('messages', []) if m.get('role') == 'tool']})
            if not CardModel.asked:
                names = {t['function']['name'] for t in data.get('tools', [])}
                results = [m.get('content') for m in data.get('messages', []) if m.get('role') == 'tool']
                described = any('clarify' in str(result) and 'parameters' in str(result) for result in results)
                if 'clarify' not in names and not described:
                    assert 'tool_describe' in names, 'The native question tool is not discoverable'
                    return self.respond(data, 'tool_describe', {'names': ['clarify']}, None)
                CardModel.asked = True
                arguments = {'questions': [{'question': 'Which project?', 'choices': ['Website', 'Research']}]}
                name = 'clarify'
                if name not in names:
                    wrapper = next(t['function'] for t in data['tools'] if t['function']['name'] == 'tool_call')
                    nested = {'name': name, 'arguments': arguments}
                    arguments = {'calls': [nested]} if 'calls' in wrapper['parameters']['properties'] else nested
                    name = 'tool_call'
                return self.respond(data, name, arguments, None)
            result = json.dumps([m.get('content') for m in data.get('messages', []) if m.get('role') == 'tool'])
            assert 'Research' in result, result
            CardModel.answered = True
            return self.respond(data, None, None, 'Research selected through the native question card.')
        if "waiting for the owner's approval" in user:
            CardModel.notified += 1
            return self.respond(data, None, None, 'Alpha is waiting for you to approve a tools change in their chat.')
        self.rfile = io.BytesIO(payload)
        return super().do_POST()


async def exercise(root, home, port):
    seed(home, port)
    import yaml
    config = yaml.safe_load((home / 'config.yaml').read_text())
    config['agent']['max_turns'] = 8
    config['platform_toolsets'] = {'cli': ['terminal', 'clarify']}
    (home / 'config.yaml').write_text(yaml.safe_dump(config))
    from hermes_cli.profiles import get_profile_dir
    for profile in ('alpha', 'beta', 'gamma'):
        (Path(get_profile_dir(profile)) / 'config.yaml').write_text(yaml.safe_dump(config))
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations
    from bot_web.workspace import WorkspaceStore, WorkspaceService, workspace_path
    from bot_web.request_delivery import deliver, deliver_native
    from bot_web.payload import copy_payload
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
    soul = home / 'SOUL.md'; soul.write_text('SYNTHETIC_CARD_PERSONA: keep this identity.\n'); original = soul.read_bytes()
    copy_payload(root / 'plugins/bot-web', home / 'plugins/bot-web')
    assert dashboard_set_agent_plugin_enabled('bot-web', enabled=True).get('ok')
    gateway = NativeGateway()
    await gateway.start()
    store = WorkspaceStore(workspace_path())
    try:
        ops = BotOperations(gateway); workspace = WorkspaceService(ops, store)
        primary = await workspace.invoke('workspace.detect_primary', {})
        await workspace.invoke('workspace.initialize', {'profile': primary['profile'], 'handle': 'aurora',
            'appearance': {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}, 'photo': None, 'expected_revision': primary['revision']})
        await workspace.invoke('agent.enable', {'profile': 'alpha', 'initialize_chat': True})
        sid = (await ops.invoke('bot.open', {'profile': primary['profile']}))['session_id']
        events = asyncio.Queue(maxsize=256); gateway.listeners.add(events)
        async def completed(target=sid):
            async with asyncio.timeout(60):
                while True:
                    event = await events.get()
                    if event.get('session_id') == target and event['type'] == 'message.complete':
                        assert event.get('payload', {}).get('status') != 'error', event
                        return
        await ops.invoke('chat.send', {'session_id': sid, 'text': 'Synthetic native questions'})
        try:
            async with asyncio.timeout(30):
                while not gateway.questions:
                    await asyncio.sleep(.1)
        except TimeoutError as error:
            raise AssertionError(f'Synthetic clarify did not open: {CardModel.question_turns}') from error
        request = (await gateway.question_prompt('questions.pending', {'session_id': sid}))['requests'][0]
        assert await gateway.question_prompt('questions.respond', {'session_id': sid, 'id': request['id'],
            'question_id': request['questions'][0]['qid'], 'answer': 'Research'}) == {'state': 'answered'}
        await completed()
        assert CardModel.answered
        assert gateway.questions == {}, 'Answered questions leaked a native pending slot'
        request_id, _ = store.request('alpha', 'agent.attach', {'profile': 'alpha', 'skills': [], 'toolsets': ['terminal'], 'expected_revision': store.read()['revision']})
        await deliver(workspace); await completed(); await deliver(workspace)
        assert CardModel.notified == 1
        assert store.db.execute('SELECT state FROM request_notifications WHERE request=?', (request_id,)).fetchone() == ('sent',)
        history = await ops.invoke('chat.history', {'session_id': sid})
        assert 'Alpha is waiting for you' in json.dumps(history)
        # A real native approval pauses Alpha; the Main Pebble gets one nudge,
        # while only the owner decision can release that original native gate.
        from native_smoke import Model
        protected = home.parent / 'protected-card-target'; protected.mkdir(); (protected / 'keep.txt').write_text('keep')
        Model.approval_target = str(protected)
        alpha = (await ops.invoke('bot.open', {'profile': 'alpha'}))['session_id']
        await ops.invoke('chat.send', {'session_id': alpha, 'text': 'nativeapproval'})
        async with asyncio.timeout(30):
            while not gateway.approval_notices: await asyncio.sleep(.1)
        await deliver_native(workspace, gateway); await completed(); await deliver_native(workspace, gateway)
        assert CardModel.notified == 2
        approval = (await ops.invoke('chat.approvals', {'session_id': alpha}))['approvals'][0]
        await ops.invoke('chat.approve', {'session_id': alpha, 'request_id': approval['request_id'], 'choice': 'deny'})
        await completed(alpha)
        assert (protected / 'keep.txt').exists()
        await deliver_native(workspace, gateway)
        assert soul.read_bytes() == original
        print(json.dumps({'revision': gateway.build['revision'], 'native_clarify_tool': True,
            'native_answer_received': True, 'main_notification_in_existing_chat_once': True, 'native_tool_approval_stays_owner_gated': True,
            'persona_preserved': True, 'model': 'deterministic-loopback-only'}))
    finally:
        store.db.close(); await gateway.stop()


def main():
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='pebble-native-cards-') as directory:
        home = Path(directory) / 'home'; home.mkdir()
        os.environ.clear()
        os.environ.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory) / 'runtime'),
            PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin', HERMES_NO_AUTO_INSTALL='1', PYTHONUNBUFFERED='1', NO_PROXY='127.0.0.1,localhost')
        os.environ.update(isolated_user_environment(directory))
        model = ThreadingHTTPServer(('127.0.0.1', 0), CardModel)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        load_plugin(root)
        try: asyncio.run(exercise(root, home, model.server_port))
        finally: model.shutdown()


if __name__ == '__main__': main()
