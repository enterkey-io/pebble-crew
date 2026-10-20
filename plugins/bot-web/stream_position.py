"""Positions in native delta text, scoped to this owner-local gateway lifetime."""
import uuid


class StreamPositions:
    def __init__(self):
        self.epoch = uuid.uuid4().hex
        self.turn = 0
        self.sessions = {}

    def event(self, event):
        sid, kind = event.get('session_id'), event.get('type')
        if not sid:
            return event
        if kind == 'message.start':
            self.turn += 1
            self.sessions[sid] = {'turn': self.turn, 'offset': 0, 'running': True}
        state = self.sessions.get(sid)
        if state is None:
            return event
        if kind == 'message.delta':
            state['offset'] += len(event.get('payload', {}).get('text') or '')
        if kind == 'message.complete':
            state['running'] = False
        # Closed sessions need only their last position; bound retained metadata.
        if len(self.sessions) > 256:
            oldest = next((key for key, value in self.sessions.items()
                           if not value['running'] and key != sid), None)
            if oldest is not None:
                del self.sessions[oldest]
        return {**event, 'stream_position': self.position(sid)}

    def position(self, sid, offset=None):
        state = self.sessions.get(sid, {'turn': 0, 'offset': 0})
        return {'epoch': self.epoch, 'turn': state['turn'],
                'offset': state['offset'] if offset is None else offset}

    def generation(self, sid):
        state = self.sessions.get(sid)
        return (state['turn'], state['running']) if state else (0, False)
