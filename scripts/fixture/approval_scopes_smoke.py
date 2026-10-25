"""Native approval scopes in disposable profiles with a deterministic loopback model."""
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
    gateway = NativeGateway()
    await gateway.start()
    try:
        ops = BotOperations(gateway)
        events = asyncio.Queue(maxsize=256)
        gateway.listeners.add(events)
        verified = []
        for profile, choice in [('alpha', 'session'), ('beta', 'always')]:
            target = home.parent / ('synthetic-approval-' + profile)
            target.mkdir()
            (target / 'test-only.txt').write_text('Disposable approval acceptance target')
            Model.approval_target = str(target)
            Model.emitted_approval = False
            sid = (await ops.invoke('bot.open', {'profile': profile}))['session_id']
            await ops.invoke('chat.send', {'session_id': sid, 'text': 'nativeapproval: synthetic scoped permission'})
            pending = None
            async with asyncio.timeout(60):
                while pending is None:
                    rows = (await ops.invoke('chat.approvals', {'session_id': sid}))['approvals']
                    pending = rows[0] if rows else None
                    if pending is None:
                        await asyncio.sleep(.1)
            assert choice in pending['choices'], pending
            result = await ops.invoke('chat.approve', {'session_id': sid,
                'request_id': pending['request_id'], 'choice': choice})
            assert result.get('resolved') == 1, result
            async with asyncio.timeout(60):
                while True:
                    event = await events.get()
                    if event.get('session_id') == sid and event.get('type') == 'message.complete':
                        assert event.get('payload', {}).get('status') != 'error', event
                        break
            assert not target.exists(), 'Approved disposable action did not execute'
            verified.append(choice)
        print(json.dumps({'revision': gateway.build['revision'], 'native_approval_scopes': verified,
            'owner_data_untouched': True, 'model': 'deterministic-local-only'}))
    finally:
        await gateway.stop()


def main():
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='pebble-approval-scopes-') as directory:
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
