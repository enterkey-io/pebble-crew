"""Recent-first native history acceptance; synthetic home and zero model turns."""
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
    db = SessionDB(db_path=Path(get_profile_dir('alpha')) / 'state.db')
    expected = []
    try:
        # The old full-history response crosses the former 4 MiB limit. Each
        # recent page stays small, and provider-only fields never reach HTTP.
        for index in range(420):
            expected.append(db.append_message('canonical-alpha', 'user' if index % 2 == 0 else 'assistant', content=f'History {index}: ' + 'text ' * 2500))
        initial = db.get_messages('canonical-alpha')
        expected_ids = [row['id'] for row in initial]
    finally:
        db.close()
    native = NativeGateway()
    await native.start()
    try:
        ops = BotOperations(native)
        opened = await ops.invoke('bot.open', {'profile': 'alpha'})
        sid = opened['session_id']
        assert 0 < len(opened['messages']) <= 60
        assert len(json.dumps(opened).encode()) < 2 * 1024 * 1024
        assert opened['history_page']['older']
        newest = [row['row_id'] for row in opened['messages']]
        assert newest == expected_ids[-60:], 'Recent page changed native row identity/order'
        db = SessionDB(db_path=Path(get_profile_dir('alpha')) / 'state.db')
        try:
            db.append_message('canonical-alpha', 'user', content='New message while paging')
        finally:
            db.close()
        page, seen = opened, newest
        pages = 1
        while page['history_page']['older']:
            page = await ops.invoke('chat.history', {'session_id': sid, 'before': page['history_page']['older']})
            seen = [row['row_id'] for row in page['messages']] + seen
            pages += 1
        assert seen == expected_ids, 'Concurrent append skipped or duplicated older rows'
        snapshot = await ops.invoke('chat.snapshot', {'session_id': sid})
        assert snapshot['messages'][-1]['text'] == 'New message while paging'
        assert len(snapshot['messages']) <= 60
        assert Model.turns == 0
        print(json.dumps({'native_history_pages': 'pass', 'initial_rows': len(opened['messages']),
            'history_rows': len(seen), 'pages': pages, 'initial_json_bytes': len(json.dumps(opened).encode()), 'model_turns': Model.turns}), flush=True)
    finally:
        await native.stop()

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='pebble-history-') as folder:
        home = Path(folder) / 'hermes'; home.mkdir()
        os.environ.update(isolated_user_environment(folder))
        os.environ.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(folder)/'runtime'), HERMES_NO_AUTO_INSTALL='1', NO_PROXY='127.0.0.1,localhost')
        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        load_plugin(ROOT)
        try:
            seed(home, model.server_port)
            asyncio.run(verify(home))
        finally:
            model.shutdown()
