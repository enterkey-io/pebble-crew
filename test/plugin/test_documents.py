import os
from pathlib import Path
import tempfile
import unittest
from test_security import Native  # Loads the isolated plugin package.
from bot_web.documents import read_document, MAX_DOCUMENT_BYTES


class DocumentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.output = self.home / 'cache/generated'
        self.output.mkdir(parents=True)

    def test_markdown_and_text_keep_content_without_exposing_paths(self):
        for name, kind in [('plan.md', 'markdown'), ('PLAN.MARKDOWN', 'markdown'), ('notes.txt', 'text')]:
            path = self.output / name
            path.write_text('# Title\n\nUnicode: é\n')
            self.assertEqual(read_document(self.home, str(path)), {'name':name, 'format':kind, 'text':path.read_text()})

    def test_private_remote_binary_links_and_oversized_outputs_are_refused(self):
        private = self.home / 'private.txt'; private.write_text('private')
        binary = self.output / 'binary.txt'; binary.write_bytes(b'\xff\x00')
        huge = self.output / 'huge.md'; huge.write_bytes(b'x'*(MAX_DOCUMENT_BYTES+1))
        link = self.output / 'linked.md'; link.symlink_to(private)
        hard = self.output / 'hard.md'; os.link(private, hard)
        html = self.output / 'page.html'; html.write_text('<script>bad</script>')
        for path in [private, binary, huge, link, hard, html, 'https://example.test/doc.md', self.output / '../generated/plan.md']:
            with self.subTest(path=path), self.assertRaises((ValueError, OSError, UnicodeError)):
                read_document(self.home, str(path))
