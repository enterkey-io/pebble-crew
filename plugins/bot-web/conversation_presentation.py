"""Owner transcript projection; native prompt roles are not human authorship."""
OWNER_KINDS = frozenset({'', 'steer', 'skill_invocation'})
ACTIVITIES = {
    'process_complete': ('process', 'Background process finished'),
    'async_delegation_complete': ('delegate_task', 'Background task finished'),
    'model_switch': ('model', 'Model changed'),
    'personality_switch': ('settings', 'Personality changed'),
    'auto_continue': ('process', 'Resuming interrupted work'),
}


def owner_input(row):
    kind = row.get('display_kind')
    return kind is None or (isinstance(kind, str) and kind in OWNER_KINDS)


def project_message(row):
    kind = row.get('display_kind')
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
    if method not in {'session.resume', 'session.history', 'bot_web.conversation.snapshot'} or not isinstance(result, dict):
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
