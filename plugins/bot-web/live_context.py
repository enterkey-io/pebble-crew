"""The briefing a live voice model (OpenAI GPT-Live or Grok Voice) gets at call start.

The selected Pebble's own SOUL.md, what it remembers about the owner (USER.md) and
their work (MEMORY.md), and its recent Bot Chat. Real work and facts stay with the
Pebble: the live model hands them back through delegation or `ask_pebble`.
"""
from pathlib import Path

SOUL_LIMIT = 6000
USER_LIMIT = 4000
MEMORY_LIMIT = 4000
HISTORY_MESSAGES = 30
HISTORY_MESSAGE_LIMIT = 800
HISTORY_LIMIT = 14000


def clip(text, limit):
    text = (text or '').strip()
    return text if len(text) <= limit else text[:limit].rsplit(' ', 1)[0] + ' …'


def _read(path, limit):
    try:
        return clip(Path(path).read_text(encoding='utf-8', errors='replace'), limit)
    except OSError:
        return ''


def profile_context(profile):
    """The Pebble's persona and memory files. Run off the event loop."""
    from hermes_cli.web_server_profiles import _config_profile_scope
    from hermes_constants import get_hermes_home
    with _config_profile_scope(profile):
        home = get_hermes_home()
        try:
            from agent.prompt_builder import load_soul_md
            soul = clip(load_soul_md(home_override=home) or '', SOUL_LIMIT)
        except Exception:
            soul = _read(home / 'SOUL.md', SOUL_LIMIT)
        return {'soul': soul,
                'user': _read(home / 'memories' / 'USER.md', USER_LIMIT),
                'memory': _read(home / 'memories' / 'MEMORY.md', MEMORY_LIMIT)}


async def recent_history(ops, sid):
    """The newest visible owner and Pebble messages, oldest first."""
    page = await ops.invoke('chat.history', {'session_id': sid})
    turns = []
    for message in page.get('messages', []):
        text = message.get('text')
        if (message.get('role') in ('user', 'assistant') and message.get('display_kind') != 'hidden'
                and isinstance(text, str) and text.strip()):
            turns.append({'role': message['role'], 'text': clip(text, HISTORY_MESSAGE_LIMIT)})
    turns = turns[-HISTORY_MESSAGES:]
    while turns and sum(len(turn['text']) for turn in turns) > HISTORY_LIMIT:
        turns.pop(0)
    return turns


def instructions(name, description, context, *, handoff):
    """`handoff` names how the live model reaches the Pebble for real work."""
    parts = [
        f'You are {name}, speaking with your owner on a live voice call. '
        f'Stay in character as {name}: same personality, values and way of talking as in text chat.'
        + (f' Your role: {clip(description, 400)}' if description else ''),
        'Voice: speak naturally and warmly at an unhurried pace. Keep answers short and '
        'conversational, like a phone call. No lists, markdown or reading out links.',
        'Interruptions: stop as soon as the owner starts talking and listen.',
    ]
    if context.get('soul'):
        parts.append('Your personality and instructions (your SOUL.md):\n' + context['soul'])
    if context.get('user'):
        parts.append('What you know about your owner:\n' + context['user'])
    if context.get('memory'):
        parts.append('Notes about your shared work and environment:\n' + context['memory'])
    parts.append(
        'Doing real work: you cannot run tools, check files, look things up or take actions '
        f'yourself on this call. {handoff} Do that for anything that needs current facts, '
        'files, tasks, messages, scheduling or any action, and for questions about your work '
        'you are not sure of. Say briefly that you are checking, then share what comes back '
        'in your own words. Never invent results or claim something was done before the '
        'answer comes back.')
    return '\n\n'.join(parts)
