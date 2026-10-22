"""Model-free connection acceptance against unmodified pinned Hermes in a disposable home."""
import asyncio
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
from native_smoke import Model, isolated_user_environment, load_plugin, seed

ROOT = Path(__file__).resolve().parents[2]

async def verify(home):
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations, InvalidOperation
    from bot_web.connection import NativeHealth
    native = NativeGateway()
    await native.start()
    try:
        health = NativeHealth(native)
        assert (await health.read())['native'] == 'responsive'
        ops = BotOperations(native)
        bound = set()
        opened = await ops.invoke('bot.open', {'profile': 'alpha'}, bind=bound.add)
        assert opened['session_id'] in bound
        snapshot = await ops.invoke('chat.snapshot', {'session_id': opened['session_id']})
        assert snapshot['session_id'] == opened['session_id'] and not snapshot['running']
        # Native process restarts without replacing the bridge's valid browser lease.
        await native.stop()
        assert (await health.read())['native'] == 'unavailable'
        await native.start()
        health.checked = None
        assert (await health.read())['native'] == 'responsive'
        try:
            await ops.invoke('chat.snapshot', {'session_id': opened['session_id']})
        except InvalidOperation as error:
            assert error.code == 'CONVERSATION_CHANGED', error.code
        else:
            raise AssertionError('Lost native binding must be explicit')
        rebound = await ops.invoke('bot.open', {'profile': 'alpha'}, bind=bound.add)
        assert (await ops.invoke('chat.snapshot', {'session_id': rebound['session_id']}))['session_id'] == rebound['session_id']
        assert Model.turns == 0, 'Connection checks must not run a model'
        print(json.dumps({'health': 'responsive', 'native_restart_rebound': True, 'read_only_snapshot': True, 'model_turns': Model.turns}), flush=True)
    finally:
        await native.stop()

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='pebble-connection-') as directory:
        home = Path(directory) / 'hermes'
        home.mkdir()
        os.environ.update(isolated_user_environment(directory))
        os.environ.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory)/'runtime'), HERMES_NO_AUTO_INSTALL='1', NO_PROXY='127.0.0.1,localhost')
        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        load_plugin(ROOT)
        try:
            seed(home, model.server_port)
            asyncio.run(verify(home))
        finally:
            model.shutdown()
