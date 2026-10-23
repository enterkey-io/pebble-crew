import unittest
import test_security  # Initializes the isolated plugin package used by this suite.
from bot_web.attachment_presentation import project_message


class UploadPresentationTests(unittest.TestCase):
    def setUp(self):
        self.files = [{'id': letter * 43, 'name': f'plan {letter}.md', 'size': 50} for letter in 'abc']
        self.refs = '\n'.join('@file:`attachments/' + f['id'] + '_' + f['name'] + '`' for f in self.files)

    def test_three_markdown_contents_are_model_context_not_owner_chat_text(self):
        text = 'Use these as reference.\n\n' + self.refs + '\n\n--- Attached Context ---\n\n' + '\n\n'.join('📄 @file:`attachments/' + f['id'] + '_' + f['name'] + '` (50 tokens)\n```md\n# Private plan content\n```' for f in self.files)
        row = {'role': 'user', 'text': text, 'row_id': 42, 'timestamp': 1}
        projected = project_message(row, self.files)
        self.assertEqual(projected['text'], 'Use these as reference.')
        self.assertEqual(projected['shared_files'], self.files)
        self.assertEqual(projected['row_id'], 42)
        self.assertEqual(row['text'], text)

    def test_literal_footer_and_markdown_in_owners_caption_are_preserved(self):
        caption = 'Keep this example:\n\n--- Attached Context ---\n\n```md\n# I typed this\n```'
        text = caption + '\n\n' + self.refs + '\n\n--- Attached Context ---\n\nmodel-only expansion'
        self.assertEqual(project_message({'role': 'user', 'text': text}, self.files)['text'], caption)

    def test_unknown_or_foreign_refs_and_assistant_text_are_never_stripped(self):
        for row in [{'role': 'user', 'text': self.refs + '\n\n--- Attached Context ---\n\nkeep'}, {'role': 'assistant', 'text': self.refs + '\n\n--- Attached Context ---\n\nkeep'}]:
            self.assertEqual(project_message(row, []), row)
        row = {'role': 'user', 'text': 'hello\n\n--- Attached Context ---\n\nthis is my message'}
        self.assertEqual(project_message(row, self.files), row)

    def test_upload_only_and_warning_paths_keep_cards_without_expansion_text(self):
        for footer in ('', '\n\n--- Context Warnings ---\nnot available', '\n\n--- Attached Context ---\nprivate'):
            row = project_message({'role': 'user', 'text': 'Please review the attached files.\n\n' + self.refs + footer}, self.files)
            self.assertEqual(row['text'], '')
            self.assertEqual(len(row['shared_files']), 3)
