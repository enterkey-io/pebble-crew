"""Model-free native completion-notice projection in a disposable Hermes home."""
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
    from hermes_state import SessionDB
    from hermes_cli.profiles import get_profile_dir
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations
    path = Path(get_profile_dir('alpha')) / 'state.db'
    db = SessionDB(db_path=path)
    raw = '[IMPORTANT: Background process fixture completed normally. PRIVATE_PROCESS_OUTPUT]'
    db.append_message('canonical-alpha', 'user', content='Actual owner question')
    db.append_message('canonical-alpha', 'user', content=raw, display_kind='process_complete', display_metadata={'display_text': 'Background process finished: example'})
    db.append_message('canonical-alpha', 'user', content='PRIVATE_WAKE', display_kind='internal_notification')
    db.append_message('canonical-alpha', 'assistant', content='Actual assistant answer')
    db.close()
    native = NativeGateway()
    await native.start()
    try:
        ops = BotOperations(native)
        opened = await ops.invoke('bot.open', {'profile': 'alpha'})
        for view in (opened, await ops.invoke('chat.snapshot', {'session_id': opened['session_id']}), await ops.invoke('chat.history', {'session_id': opened['session_id']})):
            messages = view['messages']
            assert [m['text'] for m in messages if m.get('role') == 'user'] == ['Actual owner question'], messages
            assert any(m.get('role') == 'tool' and m.get('name') == 'process' for m in messages), messages
            assert 'PRIVATE_' not in json.dumps(view), 'Native operational content reached owner presentation'
        db = SessionDB(db_path=path)
        try:
            assert any(m.get('content') == raw for m in db.get_messages('canonical-alpha')), 'Native model history was changed'
        finally: db.close()
        assert Model.turns == 0, 'Read-only attribution acceptance must not run a model'
        print(json.dumps({'native_background_authorship': 'pass', 'raw_history_unchanged': True, 'model_turns': Model.turns}), flush=True)
    finally: await native.stop()

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='pebble-attribution-') as folder:
        home = Path(folder) / 'hermes'; home.mkdir()
        os.environ.update(isolated_user_environment(folder))
        os.environ.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(folder)/'runtime'), HERMES_NO_AUTO_INSTALL='1', NO_PROXY='127.0.0.1,localhost')
        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        load_plugin(ROOT)
        try:
            seed(home, model.server_port)
            asyncio.run(verify(home))
        finally: model.shutdown()
