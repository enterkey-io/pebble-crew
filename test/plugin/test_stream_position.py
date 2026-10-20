import unittest
from bot_web.stream_position import StreamPositions


class StreamPositionTests(unittest.TestCase):
    def test_offsets_follow_unicode_native_deltas_and_turn_boundaries(self):
        positions = StreamPositions()
        def event(kind, text=''):
            return positions.event({'type': kind, 'session_id': 'test', 'payload': {'text': text}})['stream_position']
        self.assertEqual(event('message.start')['offset'], 0)
        self.assertEqual(event('message.delta', 'A😀')['offset'], 2)
        self.assertEqual(event('message.delta', 'B')['offset'], 3)
        self.assertEqual(positions.generation('test'), (1, True))
        event('message.complete')
        self.assertEqual(positions.generation('test'), (1, False))
        self.assertEqual(event('message.start')['turn'], 2)
        self.assertEqual(event('message.delta', 'C')['offset'], 1)
