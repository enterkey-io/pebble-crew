"""Native two-way reactions with isolated homes and deterministic localhost inference."""
import asyncio
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading

from native_smoke import Model, load_plugin, seed


async def exercise(root, home, port):
    seed(home, port)
    soul = home / 'SOUL.md'
    soul.write_text('You are the synthetic reaction acceptance agent.\n')
    original_soul = soul.read_bytes()
    try:
        import hermes_yaml as yaml
    except ImportError:
        import yaml
    original_config = yaml.safe_load((home / 'config.yaml').read_text())
    from bot_web.native import NativeGateway, NativeError
    from bot_web.operations import BotOperations
    from bot_web.workspace import WorkspaceStore, WorkspaceService, workspace_path
    from bot_web.payload import copy_payload
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
    # Match a real plugin install: the launch profile's integration is installed
    # and enabled before the native process performs initial tool discovery.
    copy_payload(root / 'plugins/bot-web', home / 'plugins/bot-web')
    assert dashboard_set_agent_plugin_enabled('bot-web', enabled=True).get('ok') is True
    gateway = NativeGateway()
    await gateway.start()
    store = WorkspaceStore(workspace_path())
    try:
        ops = BotOperations(gateway)
        service = WorkspaceService(ops, store)
        detection = await service.invoke('workspace.detect_primary', {})
        await service.invoke('workspace.initialize', {'profile': detection['profile'], 'handle': 'aurora',
            'appearance': {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}, 'photo': None,
            'expected_revision': detection['revision']})
        # Existing installs can already have the plugin enabled while their saved
        # CLI tool selection predates a new capability. Reopening must reconcile it.
        configured = yaml.safe_load((home / 'config.yaml').read_text())
        configured['platform_toolsets'] = {'cli': ['terminal']}
        configured['tools'] = {'tool_search': {'listing': 'off'}}
        (home / 'config.yaml').write_text(yaml.safe_dump(configured))
        sid = (await ops.invoke('bot.open', {'profile': detection['profile']}))['session_id']
        saved = yaml.safe_load((home / 'config.yaml').read_text())
        assert saved['display']['message_reactions'] is True
        assert saved['platform_toolsets']['cli'] == ['terminal', 'workspace']
        assert not (yaml.safe_load((home / 'profiles/alpha/config.yaml').read_text()).get('display') or {}).get('message_reactions')
        for key in ('model', 'providers', 'toolsets', 'approvals'):
            assert saved[key] == original_config[key], key
        events = asyncio.Queue(maxsize=256)
        gateway.listeners.add(events)

        async def turn(text):
            await ops.invoke('chat.send', {'session_id': sid, 'text': text})
            async with asyncio.timeout(60):
                while True:
                    event = await events.get()
                    if event.get('session_id') == sid and event.get('type') == 'message.complete':
                        assert event.get('payload', {}).get('status') != 'error', event
                        break
            return (await ops.invoke('chat.history', {'session_id': sid}))['messages']

        messages = await turn('nativereaction')
        user = next(m for m in messages if m.get('role') == 'user' and m.get('text') == 'nativereaction')
        assert any(r.get('emoji') == '👍' and r.get('author') == 'agent' for r in user.get('display_metadata', {}).get('reactions', [])), {'tools': sorted(Model.tools_seen), 'results': Model.tool_results, 'messages': messages}
        assert Model.emitted_reaction, Model.tools_seen
        assert Model.reaction_schema_received or 'pebble_react' in Model.tools_seen
        assert Model.reaction_discovery_guided or 'pebble_react' in Model.tools_seen
        reply = next(m for m in reversed(messages) if m.get('role') == 'assistant' and m.get('text'))
        before = Model.turns
        receipt = await ops.invoke('chat.react', {'session_id': sid, 'row_id': reply['row_id'], 'emoji': '❤️'})
        assert receipt['reactions'][0]['author'] == 'user'
        assert Model.turns == before
        messages = await turn('nativefeedback')
        assert any(m.get('text') == 'Native feedback received' for m in messages), messages
        await ops.invoke('chat.react', {'session_id': sid, 'row_id': reply['row_id'], 'emoji': None})
        reopened = await ops.invoke('bot.open', {'profile': detection['profile']})
        restored = {m.get('row_id'): m for m in reopened['messages']}
        assert restored[user['row_id']]['display_metadata']['reactions'][0]['emoji'] == '👍'
        assert not restored[reply['row_id']].get('display_metadata', {}).get('reactions')
        try:
            await ops.invoke('chat.react', {'session_id': reopened['session_id'], 'row_id': 9007199254740991, 'emoji': '👍'})
        except NativeError:
            pass
        else:
            raise AssertionError('Native reaction accepted a nonexistent message')
        assert soul.read_bytes() == original_soul
        await gateway.stop()
        from bot_web.setup import sync_runtime
        before = Model.turns
        sync_runtime(native_idle=True)
        assert Model.turns == before
        assert soul.read_bytes() == original_soul
        print(json.dumps({'supported_revision': gateway.build['revision'], 'native_agent_reaction': True,
            'native_user_feedback_received': True, 'reactions_do_not_start_model_turns': True,
            'persistent_after_resume': True, 'only_opened_profile_enabled': True, 'persona_preserved': True}))
    finally:
        store.db.close()
        await gateway.stop()


def main():
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='pebble-native-reactions-') as directory:
        home = Path(directory) / 'home'
        home.mkdir()
        os.environ.clear()
        os.environ.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory) / 'runtime'),
            PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin', HERMES_NO_AUTO_INSTALL='1',
            PYTHONUNBUFFERED='1', NO_PROXY='127.0.0.1,localhost')
        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        load_plugin(root)
        try:
            asyncio.run(exercise(root, home, model.server_port))
        finally:
            model.shutdown()


if __name__ == '__main__':
    main()
