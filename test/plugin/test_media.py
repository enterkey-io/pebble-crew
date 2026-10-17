import base64
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from test_security import Native
from bot_web.attachments import GeneratedMedia, image_type
from bot_web.attachments_native import references, normalize_reference, reference_key, output_path, read_output, CHUNK_BYTES
from bot_web.operations import BotOperations, InvalidOperation


class MediaPathTests(unittest.TestCase):
    def test_shared_strict_reference_corpus(self):
        corpus = json.loads((Path(__file__).parents[1] / 'fixtures/media-references.json').read_text())
        for row in corpus['valid']:
            self.assertEqual(normalize_reference(row['source']), row['normalized'])
            self.assertEqual(reference_key(row['source']), hashlib.sha256(row['normalized'].encode()).hexdigest())
        for value in corpus['invalid']:
            with self.assertRaises((ValueError, UnicodeError)):
                normalize_reference(value)

    def test_structured_links_and_media_never_parse_code_as_file_authority(self):
        text = '''![Chart](</home/cache/generated/chart one.png>)

[Document][report]

[report]: /home/cache/documents/report.pdf

MEDIA:"/home/cache/generated/second photo.png"

`MEDIA:/private/inline.txt`

```markdown
![Code example](/private/fenced.png)
MEDIA:/private/fenced.txt
```
'''
        self.assertEqual(references(text), ['/home/cache/generated/chart%20one.png', '/home/cache/documents/report.pdf', '/home/cache/generated/second photo.png'])
        self.assertEqual(references('**Here is the file**\nMEDIA:/home/cache/generated/report.pdf'), ['/home/cache/generated/report.pdf'])
        self.assertEqual(references('**Example:** MEDIA:/private/not-a-standalone-line.txt'), [])
        self.assertEqual(references('![Image](file:///home/cache/generated/a.png)\n\n[File](file:///home/cache/generated/b.csv)'),
            ['file:///home/cache/generated/a.png', 'file:///home/cache/generated/b.csv'])

    def test_root_scope_symlinks_hardlinks_and_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / '.hermes'
            folder = home / 'cache/generated'
            folder.mkdir(parents=True)
            path = folder / 'report.csv'
            path.write_bytes(b'x' * (CHUNK_BYTES + 20))
            relative = output_path(home, str(path))
            first = read_output(home, relative, 0, '', 'saved-row')
            self.assertEqual(len(base64.b64decode(first['data'])), CHUNK_BYTES)
            self.assertEqual(len(base64.b64decode(read_output(home, relative, CHUNK_BYTES, first['revision'], 'saved-row')['data'])), 20)
            for value in [str(home / 'config.yaml'), str(home / 'profiles/other/cache/generated/file.txt'), str(folder / '../documents/report.pdf'), str(folder / '.env'), str(folder / 'auth.json'), 'https://remote.test/a.png', 'file://remote/path', '/tmp/file.txt']:
                with self.assertRaises(ValueError):
                    output_path(home, value)
            with self.assertRaises(ValueError):
                read_output(home, relative, 0, first['revision'], 'changed-row')
            path.write_bytes(b'changed')
            with self.assertRaises(ValueError):
                read_output(home, relative, CHUNK_BYTES, first['revision'], 'saved-row')
            link = folder / 'link.csv'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                read_output(home, output_path(home, str(link)), 0, '', 'saved-row')
            hard = folder / 'hard.csv'
            hard.hardlink_to(path)
            with self.assertRaises(ValueError):
                read_output(home, relative, 0, '', 'saved-row')
            nested = folder / 'nested'
            nested.symlink_to(folder, target_is_directory=True)
            with self.assertRaises(OSError):
                read_output(home, output_path(home, str(nested / 'report.csv')), 0, '', 'saved-row')

    def test_only_verified_raster_images_receive_inline_types(self):
        from PIL import Image
        data = io.BytesIO()
        Image.new('RGB', (8, 8), 'green').save(data, 'PNG')
        self.assertEqual(image_type(data.getvalue()), 'image/png')
        for content in [b'<svg onload="alert(1)"></svg>', b'<html>test</html>', b'\x89PNG\r\n\x1a\ninvalid']:
            self.assertEqual(image_type(content), 'application/octet-stream')


class MediaNative(Native):
    data = b'column,value\n' * 110000
    changed = False

    async def call(self, method, params):
        if method == 'bot_web.media':
            offset = params['offset']
            return {'size': len(self.data), 'name': 'report.csv', 'revision': ('b' if offset and self.changed else 'a') * 64,
                    'data': base64.b64encode(self.data[offset:offset + CHUNK_BYTES]).decode()}
        return await super().call(method, params)


class MediaTransferTests(unittest.IsolatedAsyncioTestCase):
    async def test_chunks_do_not_widen_stdio_or_release_partial_changed_files(self):
        native = MediaNative()
        ops = BotOperations(native)
        await ops.invoke('bot.open', {'profile': 'alpha'})
        media = GeneratedMedia(ops)
        params = {'session_id': 'live-alpha', 'row_id': 4, 'reference': 'c' * 64}
        data, name, mime = await media.read(params)
        self.assertEqual((data, name, mime), (native.data, 'report.csv', 'application/octet-stream'))
        native.changed = True
        with self.assertRaises(InvalidOperation):
            await media.read(params)
        for changes in [{'session_id': 'foreign'}, {'row_id': True}, {'row_id': 0}, {'reference': '/etc/passwd'}]:
            with self.assertRaises(InvalidOperation):
                await media.read({**params, **changes})
