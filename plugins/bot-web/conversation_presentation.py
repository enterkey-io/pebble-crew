"""Owner transcript projection; native prompt roles are not human authorship."""
import json
import re
OWNER_KINDS = frozenset({'', 'steer', 'skill_invocation'})
ACTIVITIES = {
    'process_complete': ('process', 'Background process finished'),
    'async_delegation_complete': ('delegate_task', 'Background task finished'),
    'model_switch': ('model', 'Model changed'),
    'personality_switch': ('settings', 'Personality changed'),
    'auto_continue': ('process', 'Resuming interrupted work'),
}


# Hermes delivers a scheduled job's result to Bot Chat as an inbound turn with this
# envelope (cron/scheduler_delivery.py). The result is the Pebble's own message.
ROUTINE_RESULT = re.compile(
    r'\[Cronjob "[^"\n]{0,200}" output \u2014 scheduled job, not the user\. '
    r'Review it, act on anything that needs action, and summarize for the chat\.\]\n\n')

# Must match routines_native.WAKE (kept here so presentation imports nothing native).
ROUTINE_WAKE = 'Routine time. Do this now, here in our chat:'


# Pebble Crew hands a peer's result back to the requesting Bot Chat as an inbound turn
# beginning with this sentence (exchanges.followup_message). It is a notice, not the owner.
PEER_RESULT = 'A peer has returned a result for work requested from this existing Bot Chat. '


def peer_result(row):
    """The peer's handle when ``row`` is a returned peer result, else None."""
    if row.get('role') != 'user' or row.get('display_kind') not in (None, ''):
        return None
    text = row.get('text', row.get('content'))
    if not isinstance(text, str) or not text.startswith(PEER_RESULT):
        return None
    try:
        peer = json.loads(text[text.index('\n{') + 1:]).get('peer')
    except (ValueError, AttributeError):
        peer = None
    return peer[:80] if isinstance(peer, str) and peer.startswith('@') else '@peer'


def routine_result(row):
    """The routine's message when ``row`` is a native routine delivery, else None."""
    if row.get('role') != 'user' or row.get('display_kind') not in (None, ''):
        return None
    text = row.get('text', row.get('content'))
    match = ROUTINE_RESULT.match(text) if isinstance(text, str) else None
    return text[match.end():] if match else None


def owner_input(row):
    kind = row.get('display_kind')
    return ((kind is None or (isinstance(kind, str) and kind in OWNER_KINDS))
            and routine_result(row) is None and peer_result(row) is None)


COMPACTION_MARKERS = ('[CONTEXT COMPACTION', '[PRIOR CONTEXT')


def compaction_summary(row):
    """Hermes stores its context-compaction handoff as an ordinary row. It is
    model context, never something the owner or the agent said."""
    if row.get('_compressed_summary'):
        return True
    text = row.get('text', row.get('content'))
    return isinstance(text, str) and text.lstrip().startswith(COMPACTION_MARKERS)


def project_message(row):
    kind = row.get('display_kind')
    if compaction_summary(row):
        return {'role': 'system', **{key: row[key] for key in ('row_id', 'timestamp') if key in row}}
    peer = peer_result(row)
    if peer is not None:
        return {'role': 'tool', 'name': 'delegate_task', 'text': '', 'context': f'Result from {peer}',
                **{key: row[key] for key in ('row_id', 'timestamp') if key in row}}
    routine = routine_result(row)
    if routine is not None and routine.startswith(ROUTINE_WAKE):
        # A routine waking the Pebble with its runbook; the owner sees only what it then says.
        return {'role': 'system', **{key: row[key] for key in ('row_id', 'timestamp') if key in row}}
    if routine is not None:
        # An older routine that ran its own model: the result is the Pebble's message, so
        # its photos and stacks render like any reply.
        message = {**row, 'role': 'assistant', 'text': routine}
        if isinstance(row.get('content'), str):
            message['content'] = routine
        return message
    if kind != 'hidden' and (row.get('role') != 'user' or owner_input(row)):
        return row
    # Retain native identity/count coverage for replay without sending model-only content.
    identity = {key: row[key] for key in ('row_id', 'timestamp') if key in row}
    activity = ACTIVITIES.get(kind) if isinstance(kind, str) else None
    if kind == 'hidden' or not activity:
        return {'role': 'system', **identity}
    name, fallback = activity
    meta = row.get('display_metadata')
    title = meta.get('display_text') if isinstance(meta, dict) else None
    return {'role': 'tool', 'name': name, 'text': '',
            'context': title[:240] if isinstance(title, str) and title.strip() else fallback, **identity}


def project_result(method, result):
    if method not in {'session.resume', 'session.history', 'bot_web.conversation.history', 'bot_web.conversation.snapshot'} or not isinstance(result, dict):
        return result
    projected = dict(result)
    if isinstance(result.get('inflight'), dict):
        projected['inflight'] = {key: value for key, value in result['inflight'].items() if key != 'user'}
        if method != 'bot_web.conversation.snapshot':
            projected['inflight'].update(corrections=[], correction_offsets=[])
            projected.pop('correction_row_ids', None)
    if isinstance(result.get('messages'), list):
        projected['messages'] = [project_message(row) for row in result['messages']]
    return projected
