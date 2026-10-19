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
    manager = references.get(bots[profile]['manager'])
    path, seen = [], set()
    current = profile
    while current in references and current not in seen:
        seen.add(current)
        path.append(references[current])
        if main and current == root:
            break
        current = bots[current]['manager']
    complete = bool(main and path and path[-1] == main)
    if not main:
        summary = ('The Main Pebble is not configured or is unavailable. Do not infer one '
                   'from job titles, profile names or earlier conversations.')
    elif profile == root:
        summary = f'You are {main["handle"]}, the Main Pebble. You report directly to the human owner; no Pebble is above you.'
    else:
        summary = f'{main["handle"]} is the Main Pebble and reports directly to the human owner. '
        if complete:
            route = ' -> '.join(p['handle'] + (' (Main Pebble)' if p == main else '') for p in path)
            summary += f'Your reporting path is {route} -> human owner.'
        else:
            summary += 'Your reporting path could not be verified. Do not invent a manager.'
    return {'main_pebble': main, 'is_main_pebble': bool(main and profile == root),
        'your_manager': manager, 'your_reporting_path': path if complete else [],
        'hierarchy_summary': summary,
        'directory': [{**reference, 'role': bots[p]['role'],
            'manager_profile': bots[p]['manager'], 'manager': references.get(bots[p]['manager'])}
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
        bot['manager'] = identifier(params['manager']) if params['manager'] is not None else None
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
