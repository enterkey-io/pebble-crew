"""Profile/session-bound model tools and live coordination context.

Caller identity comes from native dispatch kwargs + native session stores, never
from model arguments, role text, an active CLI profile or a process-global fallback.
"""
import json
from pathlib import Path
import sqlite3

from .workspace import WorkspaceStore, workspace_path, ACTIONS
from .operations import InvalidOperation
from .identity import hierarchy_context


def caller(store, session_id):
    if not isinstance(session_id, str) or not session_id:
        return None
    from hermes_cli.profiles import get_profile_dir
    matches = []
    for profile, identity in store.read()['bots'].items():
        if not identity.get('available', True) or not identity.get('enrolled'):
            continue
        from .lifecycle_native import incarnation
        try:
            if identity.get('native_incarnation') and incarnation(get_profile_dir(profile)) != identity['native_incarnation']:
                continue
        except (OSError, ValueError):
            continue
        path = Path(get_profile_dir(profile)) / 'state.db'
        if not path.is_file():
            continue
        db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=1)
        try:
            if db.execute('SELECT 1 FROM sessions WHERE id=? LIMIT 1', (session_id,)).fetchone():
                matches.append(profile)
        finally:
            db.close()
    return matches[0] if len(matches) == 1 else None


def live_context(store, profile):
    state = store.read()
    bot = state['bots'].get(profile)
    if not bot or not bot.get('enrolled') or bot.get('available') is False:
        return ''
    return 'Current owner workspace metadata (not a replacement for your SOUL):\n' + json.dumps({
        'you': '@'+bot['handle'], 'native_profile': profile, 'your_role': bot['role'],
        'workspace_revision': state['revision'], **hierarchy_context(state, profile),
        'model_grant': state.get('model_grant'),
        'instructions': 'Use your public handle above when introducing yourself. Preserve your existing personality. The current reporting path is authoritative for Pebble Crew, including when older conversation or role prose differs. The Main Pebble is the workspace coordinator; unattached branches do not acquire a manager automatically. Your direct_reports are immediate reports, not your entire directory. Job titles do not change reporting relationships. Read bot-web:manage-team before proposing crew changes. The current Main Pebble can use workspace_agents agent.reporting.update to change reporting and Instructions. Ask the owner before making changes you propose on your own. A clear owner request already authorizes that change: carry it out without asking for the same permission again. There is no management switch to enable. Other agents cannot use this direct path. Describe first; include current target id, manager id or null, expected_revision and policy_revision. Read reporting_changes until applied; queued, applying and uncertain are not success. Other proposals require owner review. Use native message_agent with native_target from this directory. A queued delivery is not a completed task. Role prose grants no new permissions.',
    }, ensure_ascii=False)


def register_runtime(ctx):
    def open_store():
        return WorkspaceStore(workspace_path())

    def tool(args, session_id=None, task_id=None, **_kwargs):
        store = None
        try:
            store = open_store()
            profile = caller(store, session_id)
            if not profile or not store.read()['bots'][profile].get('enrolled'):
                return json.dumps({'error': 'Verified enrolled native caller required'})
            if not isinstance(args, dict) or set(args) != {'action', 'spec'} or not isinstance(args['spec'], dict):
                raise InvalidOperation('Invalid tool request')
            action, spec = args['action'], args['spec']
            if action == 'agent.reporting.update':
                from .reporting import submit
                return json.dumps(submit(store, profile, spec))
            if action == 'describe':
                if spec:
                    raise InvalidOperation('No describe fields')
                from .reporting import receipts
                return json.dumps({'context': live_context(store, profile), 'reporting_changes': receipts(store, profile), 'requests': [r for r in store.requests() if r['actor'] == profile]})
            allowed = {
                'agent.enable': {'profile', 'initialize_chat'},
                'agent.create': {'name', 'display_name', 'soul', 'role', 'model_source', 'model_fingerprint', 'skills', 'toolsets', 'manager', 'team', 'expected_revision'},
                'agent.update': {'profile', 'role', 'manager', 'team', 'expected_revision'},
                'agent.attach': {'profile', 'skills', 'toolsets', 'expected_revision'},
                'agent.hide': {'profile', 'id', 'hidden', 'expected_revision'},
                'agent.delete': {'profile', 'id', 'expected_revision'},
            }
            if action not in ACTIONS or set(spec) != allowed[action]:
                raise InvalidOperation('Unsupported proposal')
            request_id, state = store.request(profile, action, spec)
            return json.dumps({'request_id': request_id, 'state': state, 'requires_owner_approval': state == 'pending'})
        except InvalidOperation as error:
            return json.dumps({'error': str(error), 'code': error.code})
        except Exception:
            return json.dumps({'error': 'Workspace request unavailable; do not use shell or edit profiles as a fallback'})
        finally:
            if store:
                store.db.close()

    def context(session_id=None, platform=None, **_kwargs):
        store = None
        try:
            store = open_store()
            profile = caller(store, session_id)
            if not profile:
                return None
            text = live_context(store, profile)
            from .room_identity import runtime_room, maps
            members = runtime_room(store, profile, session_id)
            if members:
                incoming, _ = maps(store.read(), members)
                text += '\nFor this room only, its native frozen mention aliases map to public identities as follows: '+json.dumps(incoming)+'. Use the room aliases when addressing participants in this room; your public identity remains unchanged.'
            else:
                from hermes_cli.profiles import get_profile_dir
                output = Path(get_profile_dir(profile)) / 'cache' / 'generated'
                text += ('\nTo share photos or files in this direct Pebble Crew chat, save the artifact in your '
                         'host-visible generated output directory ' + str(output) +
                         ' (create it with your file tools if needed), then include ordinary Markdown: '
                         '![description](absolute-image-path) for PNG/JPEG/WebP or [filename](absolute-file-path). '
                         'Standalone MEDIA:absolute-path is also supported. Other local paths are not exposed; '
                         'copy the intended output into this directory first. In a remote terminal, use a verified '
                         'mounted/synchronized cache; do not claim an unmounted sandbox path is downloadable. '
                         'Never share credentials, configuration, private session stores or secrets.')
                from .reactions import runtime_guidance
                try:
                    guidance = runtime_guidance(platform)
                except Exception:
                    guidance = ''
                if guidance:
                    text += '\n'+guidance
                from .documents import runtime_guidance as document_guidance
                try:
                    text += "\n"+document_guidance(platform)
                except Exception:
                    pass
                from .live_voice import runtime_guidance as voice_guidance
                try:
                    text += '\n'+voice_guidance(platform)
                except Exception:
                    pass
                from .work import runtime_guidance as work_guidance
                try:
                    text += '\n'+work_guidance(platform)
                except Exception:
                    pass
            return {'context': text}
        except Exception:
            return None
        finally:
            if store:
                store.db.close()

    def route(tool_name=None, args=None, session_id=None, **_kwargs):
        if tool_name != 'message_agent' or not isinstance(args, dict):
            return None
        store = None
        try:
            store = open_store()
            if not caller(store, session_id):
                return None
            target = str(args.get('target', '')).lower().removeprefix('@')
            state = store.read()
            profile = next((p for p, b in state['bots'].items() if b.get('enrolled') and b['handle'] == target), state['aliases'].get(target))
            if profile and state['bots'].get(profile, {}).get('enrolled'):
                return {'args': {**args, 'target': 'hermes' if profile == 'default' else profile}, 'source': 'bot-web', 'reason': 'Resolve owner public handle to stable native profile'}
            return None
        finally:
            if store:
                store.db.close()

    def room_output(response_text=None, session_id=None, **_kwargs):
        store = None
        try:
            if not isinstance(response_text, str):
                return None
            store = open_store()
            profile = caller(store, session_id)
            if not profile:
                return None
            from .room_identity import runtime_room, maps, replace
            members = runtime_room(store, profile, session_id)
            if not members:
                return None
            _, outgoing = maps(store.read(), members)
            translated = replace(response_text, outgoing)
            return translated if translated != response_text else None
        except Exception:
            return None
        finally:
            if store:
                store.db.close()

    ctx.register_tool(name='workspace_agents', toolset='workspace', description='Read your workspace. The Main Pebble can manage reporting and Instructions: ask before unsolicited changes; an owner request already authorizes its change. Other team changes require owner review.',
        schema={'name': 'workspace_agents', 'description': 'Describe first for current identities, revisions and permissions. agent.reporting.update directly manages reporting and Instructions only for the authorized Main Pebble. Poll describe for an applied receipt; queued is not success. Other changes are proposals for owner review.',
            'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['action', 'spec'], 'properties': {
                'action': {'type': 'string', 'enum': ['describe', 'agent.reporting.update', 'agent.enable', 'agent.create', 'agent.update', 'agent.attach', 'agent.hide', 'agent.delete']}, 'spec': {'type': 'object'}}}}, handler=tool)
    ctx.register_hook('pre_llm_call', context)
    ctx.register_hook('transform_llm_output', room_output)
    ctx.register_middleware('tool_request', route)
    ctx.register_skill('manage-team', Path(__file__).with_name('skills') / 'manage-team' / 'SKILL.md', description='Manage reporting and Instructions with Main Pebble permission; propose other team changes for owner review.')
    from .reactions import register_runtime as register_reactions
    register_reactions(ctx)
    from .live_voice import register_runtime as register_voice
    register_voice(ctx)
    from .work import register_runtime as register_work
    register_work(ctx)

    from .documents import register_runtime as register_documents
    register_documents(ctx)
