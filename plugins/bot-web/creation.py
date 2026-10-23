"""Fresh profile setup with durable stages and no replay after native dispatch."""
import re
from .operations import InvalidOperation, fields
from .native import NativeError
from .workspace import bounded, normalize_role


async def create(service, params, state):
    fields(params, ['name', 'display_name', 'soul', 'role', 'model_source', 'model_fingerprint', 'skills', 'toolsets', 'manager', 'team', 'expected_revision'])
    name = bounded(params['name'], 40, False)
    if not re.fullmatch(r'[a-z][a-z0-9-]{1,39}', name) or (name in state['bots'] and state['bots'][name].get('available', True)):
        raise InvalidOperation('Choose a new profile name')
    if params['expected_revision'] != state['revision'] or not state['initialized']:
        raise InvalidOperation('Workspace changed. Ask for a new request.', 'STALE_REVISION')
    incomplete = service.store.incomplete_creations(exclude=getattr(service, '_creation_request', None))
    if name in incomplete or None in incomplete:
        raise InvalidOperation('An earlier creation is unconfirmed. Inspect it before creating another profile.')
    display_name = bounded(params['display_name'], 80, False)
    soul, role = bounded(params['soul'], 12000, False), normalize_role(params['role'])
    if params['model_source'] != 'default':
        raise InvalidOperation('Choose a supported explicit model grant')
    model = await service.ops.gateway.call('bot_web.models', {'action': 'describe'})
    if not model.get('supported'):
        reason = model.get('reason') or {}
        raise InvalidOperation(reason.get('message', 'This model authorization is not supported.'), reason.get('code', 'UNSUPPORTED_PROVIDER'))
    if model['fingerprint'] != params['model_fingerprint']:
        raise InvalidOperation('The primary model authorization changed. Review a new request.', 'MODEL_AUTHORIZATION_CHANGED')
    if (params['manager'] is not None and (params['manager'] not in state['bots'] or not state['bots'][params['manager']].get('enrolled'))) or (params['team'] is not None and params['team'] not in {t['id'] for t in state['teams']}):
        raise InvalidOperation('Choose an enrolled manager and existing team')
    if not isinstance(params['skills'], list) or params['skills'] or not isinstance(params['toolsets'], list) or not params['toolsets'] or any(t not in {'workspace', 'skills'} for t in params['toolsets']):
        raise InvalidOperation('Fresh bots start with reviewed workspace/skills tools only; attach other installed resources separately')
    manager_id = state['bots'].get(params['manager'], {}).get('id')
    request_id = getattr(service, '_creation_request', None)
    if request_id is None:
        request_id, status = service.store.request('owner', 'agent.create', params)
        if status != 'pending':
            raise InvalidOperation('Inspect the previous creation outcome before trying again.')
        with service.store.db:
            service.store.db.execute("UPDATE requests SET state='executing' WHERE id=? AND state='pending'", (request_id,))
    current_stage = 'not_started'
    def finish(result):
        import json
        result = {**result, 'stage': current_stage}
        with service.store.db:
            service.store.db.execute('UPDATE requests SET state=?,result=? WHERE id=?', (result['state'], json.dumps(result), request_id))
        return result

    def stage(value):
        nonlocal current_stage
        current_stage = value
        if request_id:
            import json
            with service.store.db:
                service.store.db.execute('UPDATE requests SET result=? WHERE id=? AND state=?',
                    (json.dumps({'profile': name, 'stage': value}), request_id, 'executing'))
    known_created = False
    stage('creating_profile')
    try:
        result = await service.ops.gateway.call('profiles.create', {'name': name, 'description': role['description'], 'soul': soul,
            'no_alias': True, 'no_skills': True, 'clone_channels': False, 'mirror_credentials': False})
        known_created = result.get('ok') is True
        if not known_created or result.get('soul_written') is not True:
            raise NativeError('Fresh persona creation was not fully confirmed')
        stage('profile_created')
        await service.ops.gateway.call('bot_web.runtime.prepare', {'profile': name})
        granted = await service.ops.gateway.call('bot_web.models', {'action': 'grant', 'profile': name, 'expected': model['fingerprint']})
        capabilities = await service.ops.gateway.call('profiles.describe', {'name': name})
        attached = await service.ops.gateway.call('profiles.configure', {'name': name, 'disabled_skills': [s['name'] for s in capabilities.get('skills', [])], 'enabled_toolsets': sorted(set(params['toolsets']))})
        if granted.get('configured') is not True or attached.get('applied', {}).get('skills') is not True or attached.get('applied', {}).get('toolsets') is not True:
            raise NativeError('Profile configuration was not fully confirmed')
        stage('configured')
        # Persist the entire approved role before the canonical chat can build its agent.
        await service.mirror(name, {'title': display_name, 'workspaceRole': role, 'description': role['description']})
        await service.ops.enable_existing(name)
        stage('chat_initialized')
        await service.sync()
        state = service.store.read()
        if state['bots'].get(params['manager'], {}).get('id') != manager_id:
            raise InvalidOperation('Manager identity changed during setup; inspect the created profile.')
        from .reporting import assign
        assign(state, name, params['manager'])
        state['bots'][name].update(enrolled=True, team=params['team'], role=role)
        service.store.save(state, state['revision'])
        return finish({'state': 'completed', 'profile': name, 'id': state['bots'][name]['id'], 'created': True,
                'provider': 'configured', 'runtime': 'unverified', 'canonical': True})
    except Exception:
        return finish({'state': 'partial' if known_created else 'uncertain', 'profile': name, 'canonical': False, 'runtime': 'unverified',
                'error': 'This profile was created but setup is incomplete. Ask your Hermes agent to inspect it; do not create it again.' if known_created else 'Profile creation could not be confirmed. Ask your Hermes agent to inspect this name before trying again.'})
