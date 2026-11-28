import io
import json
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import test_security  # registers the test plugin package
from bot_web import eleven_voice
from bot_web.operations import InvalidOperation


class ElevenVoiceTests(unittest.TestCase):
    def test_catalog_reads_large_paginated_voice_lists(self):
        pages = [
            {'voices': [{'voice_id': 'voice_A', 'name': 'First voice', 'description': 'x' * 280_000}],
             'has_more': True, 'next_page_token': 'next+page/='},
            {'voices': [{'voice_id': 'voice_A', 'name': 'Repeated voice'},
                        {'voice_id': 'voice_B', 'name': 'Second voice'}],
             'has_more': False},
        ]
        opener = Mock()
        opener.open.side_effect = [io.BytesIO(json.dumps(page).encode()) for page in pages]
        with patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener):
            self.assertEqual(eleven_voice.catalog('private-key'),
                             {'voices': {'voice_A': 'First voice', 'voice_B': 'Second voice'}})
        requests = [call.args[0] for call in opener.open.call_args_list]
        queries = [parse_qs(urlsplit(req.full_url).query) for req in requests]
        self.assertNotIn('voice_type', queries[0])
        self.assertEqual(queries[0]['page_size'], ['20'])
        self.assertEqual(queries[1]['next_page_token'], ['next+page/='])
        self.assertTrue(all(req.get_header('Xi-api-key') == 'private-key' for req in requests))

    def test_preview_download_uses_provider_sample_without_forwarding_key(self):
        from email.message import Message
        response = io.BytesIO(b'ID3sample')
        response.headers = Message()
        response.headers['Content-Type'] = 'audio/mpeg'
        opener = Mock()
        opener.open.return_value = response
        url = 'https://api.us.elevenlabs.io/v1/voices/voice_A/sample/audio?signature=abc'
        with patch('bot_web.eleven_voice.request', return_value={'preview_url': url}), \
             patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener):
            self.assertEqual(eleven_voice.sample('private-key', 'voice_A'), {'audio': 'SUQzc2FtcGxl'})
        req = opener.open.call_args.args[0]
        self.assertEqual(req.full_url, url)
        self.assertFalse(req.headers)
        opener.open.reset_mock()
        with patch('bot_web.eleven_voice.request', return_value={'preview_url': 'https://127.0.0.1/sample'}), \
             patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener):
            with self.assertRaises(InvalidOperation):
                eleven_voice.sample('private-key', 'voice_A')
        opener.open.assert_not_called()

    def test_preview_accepts_real_mp3_served_as_text_plain(self):
        # ElevenLabs' storage serves its sample MP3s with Content-Type: text/plain.
        from email.message import Message
        response = io.BytesIO(b'ID3\x04\x00\x00\x00\x00\x00#TSSE')
        response.headers = Message()
        response.headers['Content-Type'] = 'text/plain'
        opener = Mock()
        opener.open.return_value = response
        url = 'https://storage.googleapis.com/eleven-public-prod/premade/voices/voice_A/sample.mp3'
        with patch('bot_web.eleven_voice.request', return_value={'preview_url': url}), \
             patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener):
            self.assertTrue(eleven_voice.sample('private-key', 'voice_A')['audio'])
        opener.open.assert_called_once()

    def test_preview_rejects_non_audio_bytes(self):
        opener = Mock()
        opener.open.side_effect = [io.BytesIO(b'<html>denied</html>'), io.BytesIO(b'{"detail":"x"}')]
        url = 'https://storage.googleapis.com/eleven-public-prod/premade/voices/voice_A/sample.mp3'
        with patch('bot_web.eleven_voice.request', return_value={'preview_url': url}), \
             patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener):
            with self.assertRaises(InvalidOperation) as raised:
                eleven_voice.sample('private-key', 'voice_A')
        self.assertEqual(raised.exception.code, 'ELEVEN_SAMPLE_UNAVAILABLE')

    def test_voice_without_stored_sample_reads_a_short_line(self):
        opener = Mock()
        opener.open.return_value = io.BytesIO(b'\xff\xfb\x90\x64audio')
        with patch('bot_web.eleven_voice.request', return_value={'preview_url': None}), \
             patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener):
            self.assertTrue(eleven_voice.sample('private-key', 'voice_A')['audio'])
        req = opener.open.call_args.args[0]
        self.assertEqual(urlsplit(req.full_url).path, '/v1/text-to-speech/voice_A')
        self.assertEqual(req.get_header('Xi-api-key'), 'private-key')
        self.assertEqual(json.loads(req.data)['text'], eleven_voice.SAMPLE_TEXT)

    def test_incomplete_catalog_reports_failure_instead_of_a_partial_list(self):
        page = {'voices': [{'voice_id': 'voice_A', 'name': 'First'}],
                'has_more': True, 'next_page_token': 'repeated'}
        with patch('bot_web.eleven_voice.request', return_value=page):
            with self.assertRaises(InvalidOperation) as raised:
                eleven_voice.catalog('private-key')
            self.assertEqual(raised.exception.code, 'ELEVEN_CONNECTION_FAILED')

    def test_saved_voice_is_preserved(self):
        with patch('bot_web.eleven_voice.source', return_value=('private-key', True)), \
             patch('bot_web.eleven_voice.voice_config',
                   return_value={'elevenlabs': {'pebble_voice': 'owner-choice'}}):
            self.assertEqual(eleven_voice.preferences()['voice'], 'owner-choice')

    def test_issues_a_transcription_only_token_and_uses_exact_text_for_speech(self):
        with patch('bot_web.eleven_voice.request', return_value={'token': 'synthetic_scribe_token'}) as request:
            self.assertEqual(eleven_voice.transcription_token('private-key'), 'synthetic_scribe_token')
            request.assert_called_once_with('/v1/single-use-token/realtime_scribe', 'private-key', method='POST')
        opener = Mock()
        with patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener):
            eleven_voice.speech_stream('private-key', 'chosen_voice', 'Exact Hermes reply.')
        req = opener.open.call_args.args[0]
        self.assertEqual(req.full_url, 'https://api.elevenlabs.io/v1/text-to-speech/chosen_voice/stream?output_format=pcm_24000')
        self.assertEqual(json.loads(req.data), {'text': 'Exact Hermes reply.', 'model_id': 'eleven_multilingual_v2'})

    def test_vendor_http_error_is_safe_and_redirects_are_never_followed(self):
        opener = Mock()
        opener.open.side_effect = HTTPError('https://api.elevenlabs.io', 401, 'private detail',
                                            {}, io.BytesIO(b'private vendor data'))
        with patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener) as builder:
            with self.assertRaises(InvalidOperation) as raised:
                eleven_voice.request('/v2/voices', 'private-key')
            self.assertEqual(raised.exception.code, 'ELEVEN_KEY_REJECTED')
            self.assertNotIn('private', str(raised.exception))
            handler, = builder.call_args.args
            self.assertIsNone(handler.redirect_request(None, None, 302, None, {}, 'https://other.invalid'))
