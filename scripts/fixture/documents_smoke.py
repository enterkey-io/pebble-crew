"""Real native document tool with deferred discovery and saved tool selection."""
import asyncio
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from native_smoke import Model, load_plugin, seed, isolated_user_environment


async def exercise(root, home, port):
    seed(home, port)
    import yaml
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations
    from bot_web.workspace import WorkspaceStore, WorkspaceService, workspace_path
    from bot_web.payload import copy_payload
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
    soul = home / 'SOUL.md'
    soul.write_text('SYNTHETIC_DOCUMENT_PERSONALITY: preserve this exact identity.\n')
    original = soul.read_bytes()
    config = yaml.safe_load((home / 'config.yaml').read_text())
    config['platform_toolsets'] = {'cli': ['terminal']}
    config['tools'] = {'tool_search': {'listing': 'off'}}
    config['agent'].update(max_turns=5, coding_context='off')
    (home / 'config.yaml').write_text(yaml.safe_dump(config))
    copy_payload(root / 'plugins/bot-web', home / 'plugins/bot-web')
    assert dashboard_set_agent_plugin_enabled('bot-web', enabled=True).get('ok')
    gateway = NativeGateway()
    await gateway.start()
    store = WorkspaceStore(workspace_path())
    try:
        ops = BotOperations(gateway)
        service = WorkspaceService(ops, store)
        detected = await service.invoke('workspace.detect_primary', {})
        await service.invoke('workspace.initialize', {'profile': detected['profile'], 'handle': 'aurora',
            'appearance': {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}, 'photo': None,
            'expected_revision': detected['revision']})
        sid = (await ops.invoke('bot.open', {'profile': detected['profile']}))['session_id']
        events = asyncio.Queue(maxsize=256)
        gateway.listeners.add(events)
        await ops.invoke('chat.send', {'session_id': sid, 'text': 'nativedocument'})
        received = []
        async with asyncio.timeout(60):
            while True:
                event = await events.get()
                if event.get('session_id') != sid:
                    continue
                if event['type'] == 'document.open':
                    received.append(event['payload'])
                if event['type'] == 'message.complete':
                    assert event.get('payload', {}).get('status') != 'error', event
                    break
        assert len(received) == 1, {'events':received,'tools':sorted(Model.tools_seen),'results':Model.tool_results}
        document = received[0]
        assert document['name'] == 'plan.md' and document['format'] == 'markdown'
        assert 'Native document proof' in document['text']
        assert not {'path', 'profile', 'credential'} & set(document)
        assert any('"requested": true' in str(result) for result in Model.tool_results), Model.tool_results
        assert soul.read_bytes() == original
        assert yaml.safe_load((home / 'config.yaml').read_text())['tools']['tool_search']['listing'] == 'off'
        print(json.dumps({'revision':gateway.build['revision'], 'native_document_tool':True,
            'current_direct_chat':True, 'deferred_schema_discovered':True, 'saved_tool_selection':True,
            'persona_preserved':True, 'model':'deterministic-local-only'}))
    finally:
        store.db.close()
        await gateway.stop()


def main():
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='pebble-native-documents-') as directory:
        home = Path(directory) / 'home'; home.mkdir()
        os.environ.clear()
        os.environ.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory)/'runtime'),
            PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin', HERMES_NO_AUTO_INSTALL='1',
            PYTHONUNBUFFERED='1', NO_PROXY='127.0.0.1,localhost')
        os.environ.update(isolated_user_environment(directory))
        model = ThreadingHTTPServer(('127.0.0.1',0), Model)
        threading.Thread(target=model.serve_forever,daemon=True).start()
        load_plugin(root)
        try:
            asyncio.run(exercise(root,home,model.server_port))
        finally:
            model.shutdown()

if __name__ == '__main__':
    main()
