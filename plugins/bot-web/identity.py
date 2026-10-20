"""Workspace identity, reporting and owner-directed native introductions."""
from .operations import InvalidOperation, fields, identifier
from .native import NativeError


def hierarchy_context(state, profile):
    bots = state['bots']
    root = state['orchestrator']
    references = {p: {'id': b['id'], 'profile': p, 'handle': '@'+b['handle'],
        'native_target': 'hermes' if p == 'default' else p,
        'is_main_pebble': p == root and b['manager'] is None}
        for p, b in bots.items() if b.get('enrolled') and b.get('available', True)}
    main = references.get(root)
    if main and not main['is_main_pebble']:
        main = None
    from .reporting import path, allowed
    route, end = path(state, profile)
    main_role = bool(main and profile == root)
    status = 'main' if main_role else 'invalid' if end not in {'owner', 'unattached'} else 'unattached' if bots[profile].get('manager') is None else 'attached'
    manager_profile = bots[profile].get('manager')
    manager = references.get(manager_profile) if len(route) > 1 else None
    if main_role:
        summary = f'You are {main["handle"]}, the Main Pebble. You report directly to the human owner; no Pebble is above you.'
    elif status == 'invalid':
        summary = 'Your reporting relationship needs repair. Do not infer a manager from names, titles or older messages.'
    elif manager is None:
        summary = 'You have no configured manager. You are unattached; do not invent a reporting relationship.'
    else:
        readable = ' -> '.join(references[p]['handle'] + (' (Main Pebble)' if p == root else '') for p in route)
        summary = f'Your reporting path is {readable}' + (' -> human owner.' if end == 'owner' else ' -> no configured manager.')
    if not main:
        summary = 'The Main Pebble is not configured or is unavailable. ' + summary
    if main and not main_role:
        summary = f'{main["handle"]} is the Main Pebble and reports directly to the human owner. ' + summary
    return {'main_pebble': main, 'is_main_pebble': main_role,
        'your_manager': manager, 'your_reporting_path': [references[p] for p in route],
        'reporting_state': status, 'reporting_termination': end,
        'direct_reports': [r for p, r in references.items() if bots[p].get('manager') == profile and bots[p].get('manager_id') == bots[profile]['id']],
        'management': {'can_manage': allowed(state, profile),
            'policy_revision': state['reporting']['policy_revision'],
            'ask_before_unsolicited_changes': True, 'owner_request_authorizes_change': True},
        'hierarchy_summary': summary,
        'directory': [{**reference, 'role': bots[p]['role'],
            'manager_profile': bots[p]['manager'], 'manager': references.get(bots[p]['manager']) if bots[p].get('manager_id') == bots.get(bots[p]['manager'], {}).get('id') else None}
            for p, reference in references.items()]}


async def welcome(service, state, profile):
    profile = identifier(profile)
    bot = state['bots'].get(profile)
    if not bot or not bot.get('available') or not bot.get('enrolled'):
        raise InvalidOperation('Add this agent before requesting an introduction')
    previous = bot.get('welcome') or (state.get('welcome') if profile == state['orchestrator'] else None)
    if previous:
        return {'state': previous, 'submitted': False}
    bot['welcome'] = 'submitting'
    service.store.save(state, state['revision'])
    prompt = ('The owner has just added you to Pebble Crew. Introduce yourself briefly in your existing '
              'voice and personality. You are the same agent, with the same memory and skills. '
              f'Your public handle here is @{bot["handle"]}. '
              + hierarchy_context(state, profile)['hierarchy_summary'] + ' '
              + 'Read your workspace context and bot-web:manage-team skill. Mention only features you '
              'can verify and ask what they would like to work on. Do not create or change anything.')
    try:
        await service.ops.greet(profile, prompt)
        status = 'accepted'
    except NativeError:
        status = 'uncertain'
    state = service.store.read()
    current = state['bots'].get(profile)
    if current and current['id'] == bot['id']:
        current['welcome'] = status
        if profile == state['orchestrator']:
            state['welcome'] = status
        service.store.save(state, state['revision'])
    return {'state': status, 'submitted': status == 'accepted'}


async def invoke(service, operation, params, state, profiles):
    if operation == 'agent.welcome':
        fields(params, ['profile', 'id'])
        bot = state['bots'].get(identifier(params['profile']))
        if not bot or bot['id'] != params['id']:
            raise InvalidOperation('Agent identity changed')
        return await welcome(service, state, params['profile'])
    fields(params, ['profile', 'id', 'name', 'handle', 'appearance', 'photo', 'role', 'expected_revision']
           + (['manager'] if isinstance(params, dict) and 'manager' in params else []))
    profile = identifier(params['profile'])
    bot = state['bots'].get(profile)
    if not bot or not bot.get('available') or bot['id'] != params['id']:
        raise InvalidOperation('Agent identity changed')
    if type(params['expected_revision']) is not int or params['expected_revision'] != state['revision']:
        raise InvalidOperation('This profile changed elsewhere. Review it before saving.', 'STALE_REVISION')
    from .workspace import appearance, normalize_photo, bounded, ROLE_TEXT_LIMITS
    name = bounded(params['name'], 80, False).strip()
    if not name:
        raise InvalidOperation('Enter a name')
    handle = service.handle(state, profiles, profile, params['handle'])
    look = appearance(params['appearance'])
    role = dict(bot['role'])
    role_fields = ['title', 'description']
    if isinstance(params['role'], dict) and set(params['role']) != set(role_fields):
        role_fields += ['responsibilities', 'boundaries', 'expectedOutputs']
    fields(params['role'], role_fields)
    role.update({k: bounded(v, ROLE_TEXT_LIMITS[k]) for k, v in params['role'].items()})
    if 'manager' in params:
        from .reporting import assign
        assign(state, profile, params['manager'])
    if operation == 'agent.onboard':
        bot['enrolled'] = True
    service.graph(state)
    if params['photo'] is not None:
        photo = normalize_photo(params['photo'])
        saved = await service.ops.gateway.call('profiles.set_asset', {'name': profile, 'asset': 'avatar', 'data': photo})
        if saved.get('ok') is not True:
            raise NativeError('Photo save could not be confirmed')
    elif look['kind'] == 'photo' and not (await service.ops.gateway.call('profiles.get_asset', {'name': profile, 'asset': 'avatar'})).get('found'):
        raise InvalidOperation('Choose a photo first')
    if operation == 'agent.onboard':
        await service.ops.gateway.call('bot_web.runtime.prepare', {'profile': profile})
        await service.ops.enable_existing(profile)
    await service.mirror(profile, {'title': name, 'workspaceNameConfigured': True, 'workspaceHandle': handle, 'workspaceAppearance': look, 'workspaceRole': role, 'description': role['description'],
        **({'hidden': False} if operation == 'agent.onboard' else {})})
    bot.update(appearance=look, role=role)
    if operation == 'agent.onboard':
        bot.update(enrolled=True, role=role)
    service.store.save(state, state['revision'])
    return {'state': 'completed', 'profile': profile}
