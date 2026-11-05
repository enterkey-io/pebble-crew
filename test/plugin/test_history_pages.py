from contextlib import nullcontext
from copy import deepcopy
import json
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import test_security
from bot_web import conversation_presentation
from bot_web.conversation_history import read_page, boundary, cursor, PAGE_ROWS


class HistoryPagesTests(unittest.TestCase):
    def setUp(self):
        self.rows = [{'id': i, 'role': 'assistant' if i % 2 else 'user', 'content': f'Native row {i}'} for i in range(1, 306)]
        self.calls = []
        def get_messages(key, **options):
            self.calls.append(options)
            self.assertEqual(key, 'canonical')
            self.assertTrue(options['include_compacted'] and options['include_ancestors'] and options['latest'])
            reverse = self.rows[::-1][options['offset']:][:options['limit']]
            return reverse[::-1]
        def display(rows, *, profile_home=None, image_urls=True):
            self.assertFalse(image_urls)
            return [{'role': row['role'], 'text': row['content'], 'row_id': row['_row_id'], **({'display_kind': row['display_kind']} if 'display_kind' in row else {})} for row in rows if row.get('display_kind') != 'hidden']
        self.server = SimpleNamespace(_submit_row_target_key=lambda _: 'canonical',
            _session_db=lambda _: nullcontext(SimpleNamespace(get_messages=get_messages, get_compression_lineage=lambda key: [key])), _history_to_messages=display)
        self.projection = patch.dict(sys.modules, {'conversation_presentation': conversation_presentation})
        self.projection.start()
        self.addCleanup(self.projection.stop)

    def test_recent_first_and_older_pages_ignore_concurrent_new_messages(self):
        original = deepcopy(self.rows)
        page = read_page(self.server, {})
        self.assertEqual([r['row_id'] for r in page['messages']], list(range(246, 306)))
        self.rows += [{'id': i, 'role': 'user', 'content': 'New'} for i in range(306, 320)]
        seen = [r['row_id'] for r in page['messages']]
        while page['history_page']['older']:
            page = read_page(self.server, {}, page['history_page']['older'])
            seen = [r['row_id'] for r in page['messages']] + seen
        self.assertEqual(seen, list(range(1, 306)))
        self.assertEqual(self.rows[:305], original)
        self.assertTrue(all(call['limit'] == PAGE_ROWS + 1 for call in self.calls))

    def test_hidden_page_keeps_cursor_and_background_content_never_crosses_stdio(self):
        for row in self.rows[-60:]:
            row.update(display_kind='hidden', content='PRIVATE')
        page = read_page(self.server, {})
        self.assertTrue(page['history_page']['older'])
        self.assertEqual(len(page['messages']), 60)
        self.assertNotIn('PRIVATE', json.dumps(page))
        page = read_page(self.server, {}, page['history_page']['older'])
        self.assertEqual(page['messages'][-1]['row_id'], 245)

    def test_byte_budget_continues_without_losing_boundary_rows(self):
        for row in self.rows:
            row['content'] *= 9000
        page = read_page(self.server, {})
        self.assertLess(len(page['messages']), 60)
        boundary_id = page['messages'][0]['row_id']
        next_page = read_page(self.server, {}, page['history_page']['older'])
        self.assertEqual(next_page['messages'][-1]['row_id'], boundary_id - 1)

    def test_cursor_cannot_select_another_conversation_or_silently_reset_after_deletion(self):
        for invalid in ['invalid', cursor('another', 42), cursor('canonical', True), cursor('canonical', -1)]:
            with self.assertRaises(ValueError):
                boundary(invalid, 'canonical')
        with self.assertRaises(ValueError):
            read_page(self.server, {}, cursor('canonical', 99999))
