"""Actual native saved-media reads in disposable default and named profiles; no inference."""
import asyncio
from http.server import ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
from native_smoke import Model, load_plugin, seed


async def exercise(root, home, port):
    seed(home, port)
    from hermes_state import SessionDB
    from hermes_cli.profiles import get_profile_dir
    from bot_web.native import NativeGateway, NativeError
    from bot_web.operations import BotOperations
    from bot_web.attachments import GeneratedMedia
    from bot_web.attachments_native import reference_key
    from PIL import Image
    gateway = NativeGateway()
    await gateway.start()
    ops = BotOperations(gateway)
    media = GeneratedMedia(ops)
    try:
        for profile in ('default', 'alpha'):
            await ops.enable_existing(profile)
            profile_home = Path(get_profile_dir(profile))
            output = profile_home / 'cache/generated'
            output.mkdir(parents=True, exist_ok=True)
            image = io.BytesIO()
            Image.new('RGB', (24, 16), '#a8b99a').save(image, 'PNG')
            picture = output / 'chart one.png'
            picture.write_bytes(image.getvalue())
            document = output / 'figures.csv'
            document_bytes = b'owner-local-artifact\n' * 450000
            document.write_bytes(document_bytes)
            db = SessionDB(db_path=profile_home / 'state.db')
            canonical = db.get_session_by_title('Bot Chat')['id']
            message = db.append_message(canonical, 'assistant', f'![Chart](<{picture}>)\n\nMEDIA:"{picture}"\n\n![File URI]({picture.as_uri()})\n\n**File**\nMEDIA:{document}')
            user = db.append_message(canonical, 'user', f'![Not agent output](<{picture}>)')
            private = db.append_message(canonical, 'assistant', f'[Private config]({profile_home / "config.yaml"})')
            for number in range(40): db.append_message(canonical, 'assistant', 'Text without media ' + str(number))
            db.close()
            sid = (await ops.invoke('bot.open', {'profile': profile}))['session_id']
            page = await media.list({'session_id': sid, 'cursor': None})
            listed = list(page['files'])
            while page['next']:
                page = await media.list({'session_id': sid, 'cursor': page['next']})
                listed.extend(page['files'])
            assert {item['name'] for item in listed} == {'chart one.png', 'figures.csv'}, listed
            assert all(item['row_id'] == message for item in listed), listed
            assert next(item for item in listed if item['name'] == 'figures.csv')['size'] == len(document_bytes)
            params = {'session_id': sid, 'row_id': message, 'reference': reference_key(str(picture))}
            blob, name, mime = await media.read(params)
            assert (blob, name, mime) == (picture.read_bytes(), 'chart one.png', 'image/png')
            assert (await media.read({**params, 'reference': reference_key(picture.as_uri())}))[0] == image.getvalue()
            blob, name, mime = await media.read({**params, 'reference': reference_key(str(document))})
            assert blob == document_bytes and name == 'figures.csv'
            assert mime == 'application/octet-stream'
            for denied in [{**params, 'row_id': user}, {**params, 'row_id': private, 'reference': reference_key(str(profile_home / 'config.yaml'))}]:
                try:
                    await media.read(denied)
                except NativeError:
                    pass
                else:
                    raise AssertionError('Unauthorized native media read succeeded')
            reopened = (await ops.invoke('bot.open', {'profile': profile}))['session_id']
            assert (await media.read({**params, 'session_id': reopened}))[0] == image.getvalue()
            # A database swapped between chunks must not authorize the rest of a transfer.
            database = profile_home / 'state.db'
            backup = profile_home / '.media-original.db'
            replacement = profile_home / '.media-replacement.db'
            with sqlite3.connect(database) as source, sqlite3.connect(replacement) as target:
                source.backup(target)
            call = gateway.call
            async def replace_after_first_chunk(method, payload):
                result = await call(method, payload)
                if method == 'bot_web.media' and payload['offset'] == 0:
                    database.rename(backup)
                    replacement.replace(database)
                return result
            gateway.call = replace_after_first_chunk
            try:
                try:
                    await media.read({**params, 'session_id': reopened, 'reference': reference_key(str(document))})
                except NativeError:
                    pass
                else:
                    raise AssertionError('A replaced database authorized a partial transfer')
            finally:
                gateway.call = call
                if backup.exists():
                    backup.replace(database)
        assert Model.turns == 0, Model.turns
        print(json.dumps({'revision': gateway.build['revision'], 'default_and_named_profiles': True,
            'saved_assistant_image': True, 'nine_megabyte_chunked_file': True, 'user_and_private_paths_denied': True,
            'resume_preserves_media': True, 'database_replacement_denied': True, 'model_turns': Model.turns}))
    finally:
        await gateway.stop()


def main():
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='pebble-native-media-') as directory:
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
