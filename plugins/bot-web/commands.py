"""Native slash commands from a Pebble's chat.

Every Hermes command runs through the native command worker except those that
would replace, rewind or rename the Pebble's one Bot Chat, restart the host, or
only work in a terminal. A command that needs another Hermes interface says so.
"""
import asyncio
import json
import re
from pathlib import Path
from .operations import InvalidOperation, fields, identifier

# Offered first in the menu; native '/' alone returns a short recent list.
COMMANDS = frozenset({'model', 'context', 'usage', 'status', 'tools', 'help'})
# Session lifecycle the Bot Chat contract owns, host restarts and terminal-only UI.
BLOCKED = frozenset({
    'new', 'reset', 'clear', 'undo', 'retry', 'resume', 'sessions', 'branch', 'fork', 'handoff', 'title',
    'restart', 'quit', 'exit', 'q', 'start', 'topic', 'sethome', 'set-home', 'redraw', 'prompt', 'palette',
    'snapshot', 'snap', 'statusbar', 'battery', 'timestamps', 'skin', 'indicator', 'focus', 'mouse', 'density',
    'voice', 'wake', 'pet', 'hatch', 'journey',
})


def allowed(name):
    return re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', name) is not None and name not in BLOCKED


def valid_model(value):
    # Native subscription routes use a literal context suffix. Keep the same
    # bounded token contract; this permits only [1m], never arbitrary brackets,
    # whitespace, flags or shell syntax. Preserve the exact provider-owned ID.
    return (isinstance(value, str) and len(value) <= 250
            and re.fullmatch(r'[A-Za-z0-9_./:@+-]+(?:\[1m\])?', value) is not None
            and not value.startswith('-'))

MODEL_GROUPS = ('ollama-cloud', 'ollama-local')
PROVIDER_ID = r'[A-Za-z0-9_.:-]{1,128}'


def model_groups_path():
    """Optional owner rules for the model picker, beside the private workspace store."""
    from .workspace import workspace_path
    return workspace_path().parent / 'model-groups.json'


def owner_model_groups(path=None):
    """Read and normalize owner model picker rules; a missing or invalid file means none."""
    try:
        path = Path(path) if path is not None else model_groups_path()
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 64_000:
            return None
        value = json.loads(path.read_text())
    except Exception:
        return None
    if not isinstance(value, dict) or value.get('schema') != 1 or set(value) - {'schema', 'merge', 'hide', 'prefer'}:
        return None
    merge, hide, prefer = value.get('merge', []), value.get('hide', {}), value.get('prefer', {})
    model_list = lambda items, limit: (isinstance(items, list) and len(items) <= limit
                                       and all(valid_model(item) for item in items))
    if not (isinstance(merge, list) and len(merge) <= 50 and all(
                isinstance(item, dict) and set(item) == {'canonical', 'provider', 'group', 'spellings'}
                and valid_model(item['canonical']) and isinstance(item['provider'], str)
                and re.fullmatch(PROVIDER_ID, item['provider']) and item['group'] in MODEL_GROUPS
                and model_list(item['spellings'], 50) for item in merge)
            and isinstance(hide, dict) and all(group in MODEL_GROUPS and model_list(models, 500)
                                               for group, models in hide.items())
            and isinstance(prefer, dict) and len(prefer) <= 500 and all(
                valid_model(model) and isinstance(provider, str) and re.fullmatch(PROVIDER_ID, provider)
                for model, provider in prefer.items())):
        return None
    return {'merge': merge, 'hide': hide, 'prefer': prefer}


async def invoke(ops, operation, params):
    fields(params, ['session_id', *{
        'chat.model.options': [], 'chat.model.select': ['provider', 'model', 'confirm'],
    }.get(operation, ['text'])])
    sid = identifier(params['session_id'])
    profile = ops.sessions.get(sid)
    if not profile or await ops.stamp(profile) != ops.session_incarnations.get(sid):
        raise InvalidOperation('Reopen this Pebble before using commands')
    await ops.bot(profile)
    if operation == 'chat.model.options':
        result = await ops.gateway.call('model.options', {'session_id': sid, 'explicit_only': True})
        providers = []
        for item in result.get('providers', [])[:80]:
            slug, label = item.get('slug'), item.get('name')
            if not isinstance(slug, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', slug):
                continue
            models = list(dict.fromkeys(model for model in item.get('models', [])[:3000]
                if valid_model(model)))
            if models and item.get('authenticated') is not False:
                providers.append({'id': slug, 'name': str(label or slug)[:120], 'models': models})
        options = {'model': str(result.get('model') or '')[:250], 'provider': str(result.get('provider') or '')[:128],
                   'providers': providers}
        if groups := owner_model_groups():
            options['model_groups'] = groups
        return options
    if operation == 'chat.model.select':
        model, provider, confirm = params['model'], params['provider'], params['confirm']
        if (not isinstance(provider, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', provider)
            or provider.startswith('-') or not valid_model(model)
            or type(confirm) is not bool):
            raise InvalidOperation('Invalid model selection')
        selected = await ops.gateway.call('config.set', {
            'session_id': sid, 'key': 'model', 'value': f'{model} --provider {provider} --session',
            'confirm_expensive_model': confirm,
        })
        return {'value': str(selected.get('value') or '')[:250],
                'confirm_required': selected.get('confirm_required') is True,
                'message': str(selected.get('confirm_message') or selected.get('warning') or '')[:1000],
                'deferred': selected.get('deferred') is True}
    text = params['text']
    if not isinstance(text, str) or not text.startswith('/') or len(text) > 1000 or '\n' in text or '\r' in text:
        raise InvalidOperation('Invalid command')
    name = text[1:].split(' ', 1)[0].lower()
    if operation == 'chat.commands':
        if ' ' in text and not allowed(name):
            return {'items': [], 'replace_from': len(text)}
        # Native '/' is a ranked, bounded recent list, not the full catalog. Also query the
        # common commands by prefix so older homes never return an empty menu.
        queries = [text] if ' ' in text else list(dict.fromkeys(
            [text, *('/' + command for command in sorted(COMMANDS) if command.startswith(name))]))
        results = await asyncio.gather(*(ops.gateway.call('complete.slash', {'session_id': sid, 'text': query}) for query in queries))
        items, seen = [], set()
        for item in [item for result in results for item in result.get('items', [])][:600]:
            token = item.get('text', '')
            if not isinstance(token, str) or not token or len(token) > 250:
                continue
            if ' ' not in text and not allowed(token.strip().lstrip('/').split(' ', 1)[0].lower()):
                continue
            if token in seen:
                continue
            if len(items) == 100:
                break  # The app accepts at most 100 suggestions.
            seen.add(token)
            items.append({'text': token, 'label': str(item.get('display') or token)[:250], 'description': str(item.get('meta') or '')[:300]})
        start = results[0].get('replace_from', 1) if results and ' ' in text else 1
        return {'items': items, 'replace_from': start if type(start) is int and 0 <= start <= len(text) else 1}
    if operation != 'chat.command' or not allowed(name):
        raise InvalidOperation('This command is not supported in Pebble Crew', 'UNSUPPORTED_COMMAND')
    # Avoid a terminal picker with no input reader. A typed model routes through
    # Hermes's worker + native live-session side-effect mirror, not a model turn.
    if name == 'model' and not text[1:].partition(' ')[2].strip():
        return {'output': 'Use /model <model name> to change this conversation’s model.'}
    result = await ops.gateway.call('slash.exec', {'session_id': sid, 'command': text[1:]})
    output = result.get('output')
    if not isinstance(output, str) or len(output) > 64000 or result.get('type'):
        raise InvalidOperation('This command requires a different Hermes interface', 'UNSUPPORTED_COMMAND')
    return {'output': output}
