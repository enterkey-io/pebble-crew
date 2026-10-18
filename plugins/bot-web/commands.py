"""Session-scoped native commands supported by this browser surface.

Interactive terminal, destructive lifecycle and arbitrary plugin commands stay
out of the browser catalog until their native response contracts are supported.
"""
import asyncio
from .operations import InvalidOperation, fields, identifier

COMMANDS = frozenset({'model', 'context', 'usage', 'status', 'tools', 'help'})

async def invoke(ops, operation, params):
    fields(params, ['session_id', 'text'])
    sid, text = identifier(params['session_id']), params['text']
    profile = ops.sessions.get(sid)
    if not profile or await ops.stamp(profile) != ops.session_incarnations.get(sid):
        raise InvalidOperation('Reopen this Pebble before using commands')
    await ops.bot(profile)
    if not isinstance(text, str) or not text.startswith('/') or len(text) > 1000 or '\n' in text or '\r' in text:
        raise InvalidOperation('Invalid command')
    name = text[1:].split(' ', 1)[0].lower()
    if operation == 'chat.commands':
        if ' ' in text and name not in COMMANDS:
            return {'items': [], 'replace_from': len(text)}
        # Native '/' is a ranked, bounded recent list, not the full catalog.
        # Query supported prefixes explicitly so older homes never return an empty menu.
        queries = [text] if ' ' in text else ['/' + command for command in sorted(COMMANDS) if command.startswith(name)]
        results = await asyncio.gather(*(ops.gateway.call('complete.slash', {'session_id': sid, 'text': query}) for query in queries))
        items, seen = [], set()
        for item in [item for result in results for item in result.get('items', [])][:600]:
            token = item.get('text', '')
            if not isinstance(token, str) or not token or len(token) > 250:
                continue
            if ' ' not in text and token.strip().lstrip('/').split(' ', 1)[0].lower() not in COMMANDS:
                continue
            if token in seen:
                continue
            seen.add(token)
            items.append({'text': token, 'label': str(item.get('display') or token)[:250], 'description': str(item.get('meta') or '')[:300]})
        start = results[0].get('replace_from', 1) if results and ' ' in text else 1
        return {'items': items, 'replace_from': start if type(start) is int and 0 <= start <= len(text) else 1}
    if operation != 'chat.command' or name not in COMMANDS:
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
