"""Owner review binds an immutable proposal to its actual effect identities."""
import hashlib
import json


def basis(state, actor, action, spec):
    bots = state['bots']
    target = bots.get(spec.get('profile'), {})
    manager = bots.get(spec.get('manager'), {})
    return {'actor': bots.get(actor, {}).get('id'), 'target': target.get('id'),
            'manager': manager.get('id'), 'team': next((t for t in state['teams'] if t['id'] == spec.get('team')), None),
            'role': {key: target.get(key) for key in ('role', 'manager_id', 'team')} if action == 'agent.update' else None}


def review(store, request, state):
    if not request or request.get('unreadable'):
        return {'kind': 'blocked', 'reason': 'This request could not be read. Retry without submitting another request.'}
    if request['state'] != 'pending':
        return {'kind': 'outcome', 'request': request}
    spec, action = request['spec'], request['action']
    saved = store.db.execute('SELECT basis FROM request_context WHERE request=?', (request['id'],)).fetchone()
    original = json.loads(saved[0]) if saved else None
    current = basis(state, request['actor'], action, spec)
    reason = None
    for field in ('actor', 'target', 'manager', 'team', 'role'):
        if original is not None and original[field] != current[field]:
            reason = 'The reviewed agent, manager or affected settings changed. Ask the pebble to review this proposal.'
    if request['actor'] != 'owner' and (not current['actor'] or state['bots'][request['actor']].get('available') is False):
        reason = 'The requesting pebble is no longer available.'
    if action == 'agent.create':
        name = spec.get('name')
        model = state.get('model_grant') or {}
        if not state['initialized']:
            reason = 'Finish workspace setup first.'
        elif name in state['bots'] and state['bots'][name].get('available', True):
            reason = 'This profile name is already in use. Inspect it before creating anything.'
        elif name in store.incomplete_creations() or None in store.incomplete_creations():
            reason = 'An earlier creation outcome is unconfirmed. Inspect it without creating it again.'
        elif not model.get('supported') or not spec.get('model_fingerprint') or model.get('fingerprint') != spec['model_fingerprint']:
            reason = 'The proposed model authorization is unavailable or changed. Review it in Hermes.'
        elif spec.get('manager') is not None and (not current['manager'] or not state['bots'][spec['manager']].get('enrolled') or state['bots'][spec['manager']].get('available') is False):
            reason = 'The proposed manager is no longer available.'
        elif spec.get('team') is not None and current['team'] is None:
            reason = 'The proposed crew is no longer available.'
    elif 'expected_revision' in spec and spec['expected_revision'] != state['revision']:
        reason = 'The affected setup needs a fresh proposal. This request has not been executed.'
    if reason:
        return {'kind': 'blocked', 'reason': reason, 'request': request}
    # Global revision is an optimistic commit guard, not consent. Creation can
    # survive an unrelated edit while the manager/model/target bindings agree.
    context = {'workspace': state['id'], 'id': request['id'], 'fingerprint': request['fingerprint'],
               'bindings': current, 'model': spec.get('model_fingerprint')}
    if action != 'agent.create':
        context['revision'] = state['revision']
    digest = hashlib.sha256(json.dumps(context, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'kind': 'ready', 'request': request, 'digest': digest,
            'current_context': original is None or (action == 'agent.create' and spec.get('expected_revision') != state['revision']),
            'legacy': original is None, 'manager': spec.get('manager'), 'manager_identity': current['manager']}
