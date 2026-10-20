"""Additional named stdio handlers, registered through Hermes's method seam.

No native handler is replaced. Only our own fixed plugin code can be activated;
callers cannot choose filesystem paths, commands, repositories or credentials.
"""
import hashlib
import os
from pathlib import Path
import shutil
import tempfile


def register(source):
    from tui_gateway import server
    source = Path(source).resolve()

    def prepare(rid, params):
        try:
            if not isinstance(params, dict) or set(params) != {'profile'}:
                raise ValueError()
            profile = params['profile']
            from hermes_cli.profiles import get_profile_dir, list_profiles
            if profile not in {p.name for p in list_profiles()}:
                raise ValueError()
            home = Path(get_profile_dir(profile)).resolve()
            destination = home / 'plugins' / 'bot-web'
            from payload import payload_paths
            files = payload_paths(source)
            if destination.is_symlink():
                raise ValueError()
            if destination.exists():
                for path in files:
                    target = destination / path.relative_to(source)
                    if not target.is_file() or target.is_symlink() or hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(target.read_bytes()).digest():
                        raise ValueError('Installed integration needs a coordinated update')
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = Path(tempfile.mkdtemp(prefix='.bot-web-', dir=destination.parent))
                try:
                    for path in files:
                        target = temporary / path.relative_to(source)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(path, target)
                    os.replace(temporary, destination)
                finally:
                    if temporary.exists():
                        shutil.rmtree(temporary)
            # Version adapters share native runtime scoping; the older signature has
            # no hydrate_secrets option, so use only their common supported argument.
            with server._session_profile_runtime_scope({'profile_home': str(home)}):
                from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
                result = dashboard_set_agent_plugin_enabled('bot-web', enabled=True)
                if result.get('ok') is not True:
                    raise ValueError('Native activation not confirmed')
            return server._ok(rid, {'prepared': True, 'runtime': 'refresh_required'})
        except Exception:
            return server._err(rid, 5069, 'Workspace runtime preparation not confirmed')

    server.method('bot_web.runtime.prepare')(prepare)

    def live_snapshot(rid, params):
        """Native display snapshot with a proven current-turn row anchor."""
        if not isinstance(params, dict) or set(params) != {'session_id'}:
            return server._err(rid, -32602, 'Invalid conversation snapshot')
        session, error = server._sess_nowait(params, rid)
        if error:
            return error
        sid = params['session_id']
        # Native display reads deliberately keep database I/O outside the
        # history lock. Refresh live text under the lock without requiring the
        # model to stop streaming while the database is read.
        result = server._live_session_payload(sid, session)
        with session['history_lock']:
            turn = session.get('inflight_turn') or {}
            result['snapshot_consistent'] = (result.get('turn_started_at') == turn.get('started_at')
                if session.get('running') else not result.get('running'))
            if result['snapshot_consistent']:
                result['inflight'] = server._inflight_snapshot(session)
                result['queued'] = server._queued_prompt_snapshot(session)
                envelopes = ([session['queued_prompt']] if session.get('queued_prompt') else []) + list(session.get('queued_prompts') or [])
                result['deferred_prompts'] = [
                    {'text': server._inflight_text(envelope.get('text')),
                     'row_id': (envelope.get('_submit_user_row') or {}).get('_row_id')}
                    for envelope in envelopes]
            agent = session.get('agent')
            messages = getattr(agent, '_session_messages', None)
            start = getattr(agent, '_persist_user_message_idx', None)
            staged = session.get('_submit_user_row')
            candidate = staged if isinstance(staged, dict) else (
                messages[start] if isinstance(messages, list) and type(start) is int
                and 0 <= start < len(messages) else None)
            # A structural native cursor selects the row. Text only verifies
            # that cursor, and a row in the pre-turn prefix cannot be current.
            prefix = {row.get('_row_id') for row in session.get('history', [])
                      if isinstance(row, dict)}
            if (result.get('running') and session.get('running')
                    and result['snapshot_consistent']
                    and isinstance(candidate, dict)
                    and candidate.get('role') == 'user'
                    and type(candidate.get('_row_id')) is int and candidate['_row_id'] > 0
                    and candidate['_row_id'] not in prefix
                    and server._inflight_text(candidate.get('content')) == turn.get('user')):
                result['active_user_row_id'] = candidate['_row_id']
                if isinstance(messages, list):
                    anchor = next((index for index, row in enumerate(messages)
                                   if row.get('_row_id') == candidate['_row_id']), None)
                    if anchor is not None:
                        corrections = (result.get('inflight') or {}).get('corrections') or []
                        users = [row for row in messages[anchor + 1:] if row.get('role') == 'user']
                        if len(users) <= len(corrections) and all(
                                server._inflight_text(row.get('content')) == corrections[index]
                                for index, row in enumerate(users)):
                            result['correction_row_ids'] = [
                                row.get('_row_id') if type(row.get('_row_id')) is int
                                and row['_row_id'] > 0 else None for row in users]
        return server._ok(rid, result)

    server.method('bot_web.conversation.snapshot')(live_snapshot)
