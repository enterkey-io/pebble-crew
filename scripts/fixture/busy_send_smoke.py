"""Real native busy sends, in a disposable home with a deterministic local model."""
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
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations
    from bot_web.workspace import WorkspaceStore, WorkspaceService, workspace_path
    from bot_web.payload import copy_payload
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
    soul = home / 'SOUL.md'
    soul.write_text('SYNTHETIC_BUSY_SEND_PERSONALITY: preserve this identity.\n')
    original = soul.read_bytes()
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
        first = await ops.invoke('chat.send', {'session_id': sid, 'text': 'nativeworking'})
        assert await asyncio.to_thread(Model.slow_started.wait, 20), 'Model did not start'
        correction = await ops.invoke('chat.send', {'session_id': sid, 'text': 'nativecorrection'})
        assert correction.get('status') == 'redirected', correction
        assert await asyncio.to_thread(Model.correction_started.wait, 20), 'Correction did not reach model'
        snapshot = await ops.invoke('bot.open', {'profile': detected['profile']})
        live = snapshot.get('inflight') or {}
        assert 'nativecorrection' in live.get('corrections', []), live
        assert len(live.get('correction_offsets', [])) == len(live['corrections']), live
        assert type(snapshot.get('active_user_row_id')) is int, snapshot
        assert len(snapshot.get('correction_row_ids') or []) == 1, snapshot
        assert type(snapshot['correction_row_ids'][0]) is int, snapshot
        assert snapshot['stream_position']['epoch'] and snapshot['stream_position']['turn'] > 0
        offset = 0
        async with asyncio.timeout(60):
            while True:
                event = await events.get()
                if event.get('session_id') == sid and event.get('type') == 'message.delta':
                    offset += len(event.get('payload', {}).get('text') or '')
                    assert event['stream_position']['offset'] == offset, event
                if event.get('session_id') == sid and event.get('type') == 'message.complete':
                    if 'Native redirected reply' in str(event.get('payload', {}).get('text')):
                        break
        history = await ops.invoke('chat.history', {'session_id': sid})
        users = [row for row in history['messages'] if row.get('role') == 'user']
        assert sum(row.get('text') == 'nativeworking' for row in users) == 1, users
        assert sum(row.get('text') == 'nativecorrection' for row in users) == 1, users
        assert any(row.get('text') == 'Native redirected reply' for row in history['messages']), history
        from bot_web.commands import invoke as command
        before_commands = Model.turns
        status = await command(ops, 'chat.command', {'session_id': sid, 'text': '/status'})
        assert isinstance(status.get('output'), str) and status['output'].strip()
        assert Model.turns == before_commands, 'Slash status must not run a model'
        assert soul.read_bytes() == original
        print(json.dumps({'revision': gateway.build['revision'], 'native_busy_send': True,
            'default_disposition': correction['status'], 'correction_offsets': True,
            'distinct_native_user_rows': True, 'persona_preserved': True,
            'native_status_command': True, 'stream_positions': True,
            'first_receipt_fields': sorted(first), 'correction_receipt_fields': sorted(correction),
            'model': 'deterministic-local-only'}))
    finally:
        store.db.close()
        await gateway.stop()


def main():
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='pebble-native-busy-send-') as directory:
        home = Path(directory) / 'home'
        home.mkdir()
        os.environ.clear()
        os.environ.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory) / 'runtime'),
            PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin', HERMES_NO_AUTO_INSTALL='1',
            PYTHONUNBUFFERED='1', NO_PROXY='127.0.0.1,localhost')
        os.environ.update(isolated_user_environment(directory))
        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        load_plugin(root)
        try:
            asyncio.run(exercise(root, home, model.server_port))
        finally:
            model.shutdown()


if __name__ == '__main__':
    main()
