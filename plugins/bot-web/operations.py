"""Typed operations over real native handlers. No arbitrary RPC passthrough."""

import asyncio
import re

from .native import NativeError


class InvalidOperation(Exception):
    def __init__(self, message, code="INVALID_PARAMETERS"):
        super().__init__(message)
        self.code = code


def fields(params, allowed):
    if not isinstance(params, dict) or set(params) != set(allowed):
        raise InvalidOperation("Invalid operation fields")


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", value):
        raise InvalidOperation("Invalid identifier")
    return value


def approval_choices(request):
    allowed = ['once', 'deny']
    if not request.get('smart_denied') and request.get('allow_session') is not False:
        allowed.insert(1, 'session')
        if request.get('allow_permanent') is not False:
            allowed.insert(-1, 'always')
    offered = request.get('choices')
    return [choice for choice in allowed if offered is None or (isinstance(offered, list) and choice in offered)]


class BotOperations:
    def __init__(self, gateway):
        self.gateway = gateway
        self.sessions = {}
        self.session_incarnations = {}
        self.open_lock = asyncio.Lock()

    async def profiles(self):
        result = await self.gateway.call("profiles.list", {"include_sessions": True})
        if result.get("bot_mode_protocol") is not True:
            raise NativeError("Native Bot Mode protocol unavailable")
        return result["profiles"]

    async def roster(self):
        return [row for row in await self.profiles()
                if isinstance(row.get("ui_meta", {}).get("hermes-bots"), dict)
                and row['ui_meta']['hermes-bots'].get('hidden') is not True]

    @staticmethod
    def summary(row):
        meta = row.get("ui_meta", {}).get("hermes-bots")
        managed = isinstance(meta, dict)
        meta = meta if managed else {}
        title = meta.get('title') or row.get('display_name') or row['name']
        if not meta.get('workspaceNameConfigured') and title == row['name']:
            title = title.replace('-', ' ').replace('_', ' ').title()
        chat = row.get('canonical_session') or {}
        count = max(0, int(chat.get('live_message_count', chat.get('message_count')) or 0))
        activity = chat.get('last_active')
        return {"profile": row["name"],
                "name": title,
                "description": (meta or {}).get("description") or row.get("description") or "",
                "managed": managed,
                "canonical": bool(chat.get("id")),
                "hidden": meta.get('hidden') is True, "pinned": meta.get('pinned') is True,
                "pin_configured": 'pinned' in meta,
                "preview": str(chat.get('preview') or '')[:500],
                "cursor": count,
                "last_activity": activity if count and type(activity) in {int, float} and 0 < activity < float('inf') else 0,
                "conversation_id": str(chat.get('resolved_id') or chat.get('id') or ''), **row.get('_presentation_clock', {})}

    async def greet(self, profile, text, title='Introduction in Pebble Crew', queued=False):
        opened = await self.invoke('bot.open', {'profile': profile})
        sid = opened['session_id']
        if await self.stamp(profile) != self.session_incarnations.get(sid):
            raise InvalidOperation('This profile changed before its introduction')
        return await self.gateway.call('prompt.submit', {'session_id': sid, 'text': text,
            'display_kind': 'hidden', 'title_preview': title, 'queued': queued})

    async def enable_existing(self, profile):
        identifier(profile)
        async with self.open_lock:
            row = next((p for p in await self.profiles() if p["name"] == profile), None)
            if row is None:
                raise InvalidOperation("Existing Hermes profile unavailable")
            lookup = {"profile": profile, "title": "Bot Chat", "include_hidden": True, "limit": 100}
            found = await self.gateway.call("session.list", lookup)
            matches = [s for s in found["sessions"] if (s.get("root_title") or s.get("title")) == "Bot Chat"]
            canonical = row.get("canonical_session") or {}
            if not matches and (canonical.get("id") or await self.gateway.has_stored_bot_chat(profile)):
                raise InvalidOperation("Existing or retired Bot Chat needs confirmation in Hermes")

            # Only add an absent namespace with native compare-and-swap. Never copy a
            # profile or rewrite SOUL, model settings, skills, memory or channel tokens.
            if not isinstance(row.get("ui_meta", {}).get("hermes-bots"), dict):
                revision = row.get("ui_meta_revisions", {}).get("hermes-bots", 0)
                if type(revision) is not int or revision < 0:
                    raise NativeError("Invalid profile metadata revision")
                result = await self.gateway.call("profiles.configure", {"name": profile,
                    "ui_meta": {"hermes-bots": {"title": row.get("display_name") or profile.replace("-", " ").replace("_", " ").title()}},
                    "ui_meta_expected_revisions": {"hermes-bots": revision}})
                if result.get("applied", {}).get("ui_meta") is not True:
                    raise InvalidOperation("Profile metadata changed; refresh before trying again")

            if not matches:
                # Recheck after marking: another native client may have initialized it.
                found = await self.gateway.call("session.list", lookup)
                matches = found["sessions"]
                if not matches:
                    if await self.gateway.has_stored_bot_chat(profile):
                        raise InvalidOperation("Existing Bot Chat needs confirmation in Hermes")
                    created = await self.gateway.call("session.create", {"profile": profile,
                        "title": "Bot Chat", "hidden": True, "follow_profile_config": True})
                    try:
                        await self.gateway.call("session.title", {"session_id": identifier(created["session_id"]),
                            "title": "Bot Chat"})
                    except NativeError:
                        # An external native writer can win the canonical title race.
                        # Adopt that winner; never submit a prompt or force a rename.
                        if not (await self.gateway.call("session.list", lookup))["sessions"]:
                            raise
            bot = await self.bot(profile)
            if not (bot.get("canonical_session") or {}).get("id"):
                raise NativeError("Native canonical chat not confirmed")
            return self.summary(bot)

    async def stamp(self, profile):
        result = await self.gateway.call('bot_web.lifecycle', {'action': 'inspect', 'profile': profile})
        stamp = result.get('incarnation')
        if not isinstance(stamp, str) or not re.fullmatch('[0-9a-f]{64}', stamp):
            raise NativeError('Native profile identity unavailable')
        return stamp

    async def bot(self, profile, *, require_chat=False):
        identifier(profile)
        for bot in await self.roster():
            if bot["name"] == profile:
                if require_chat and not (bot.get("canonical_session") or {}).get("id"):
                    raise InvalidOperation("This Hermes profile has no active Bot Chat", "BOT_CHAT_MISSING")
                return bot
        raise InvalidOperation("Managed bot unavailable")

    async def invoke(self, operation, params, *, bind=None):
        if operation == "agents.list":
            fields(params, [])
            return {"agents": [self.summary(row) for row in await self.profiles()]}
        if operation == "agent.enable":
            fields(params, ["profile", "initialize_chat"])
            if params["initialize_chat"] is not True:
                raise InvalidOperation("Explicit native chat initialization required")
            return await self.enable_existing(params["profile"])
        if operation == "bots.list":
            fields(params, [])
            return {"bots": [self.summary(b) for b in await self.roster()]}
        if operation == "bot.open":
            fields(params, ["profile"])
            async with self.open_lock:
                bot = await self.bot(params["profile"], require_chat=True)
                canonical = bot["canonical_session"]
                stamp = await self.stamp(bot["name"])
                live = await self.gateway.call("bot_web.conversation.resume", {"profile": bot["name"],
                    "session_id": canonical["id"]})
                sid = identifier(live["session_id"])
                if await self.stamp(bot['name']) != stamp:
                    await self.gateway.call('session.close', {'session_id': sid})
                    raise InvalidOperation('Profile changed while opening this conversation')
                self.sessions[sid] = bot["name"]
                self.session_incarnations[sid] = stamp
                if bind is not None:
                    bind(sid)
                await self.gateway.call('bot_web.reactions.enable', {'session_id': sid})
                live = await self.gateway.call('bot_web.conversation.snapshot', {'session_id': sid})
                return {"session_id": sid, "profile": bot["name"],
                        "canonical_id": canonical["id"], "messages": live.get("messages", []),
                        **({"history_page": live["history_page"]} if "history_page" in live else {}),
                        "inflight": live.get("inflight"), "running": live.get("running") is True,
                        "active_user_row_id": live.get('active_user_row_id'),
                        "live_assistant_row_ids": live.get('live_assistant_row_ids', []),
                        "correction_row_ids": live.get('correction_row_ids'),
                        "deferred_prompts": live.get('deferred_prompts', []),
                        "stream_position": live.get('stream_position')}
        if operation == 'chat.snapshot':
            fields(params, ['session_id'])
            sid = identifier(params['session_id'])
            profile = self.sessions.get(sid)
            if not profile or await self.stamp(profile) != self.session_incarnations.get(sid):
                raise InvalidOperation('Reopen the changed conversation', 'CONVERSATION_CHANGED')
            result = await self.gateway.call('bot_web.conversation.snapshot', {'session_id': sid})
            if result.get('missing') or await self.stamp(profile) != self.session_incarnations.get(sid):
                raise InvalidOperation('Conversation changed during snapshot', 'CONVERSATION_CHANGED')
            return {**result, 'session_id': sid, 'profile': profile}
        if operation in {"chat.send", "chat.stop", "chat.history", "chat.approvals", "chat.approve", "chat.replay", "chat.react"}:
            extras = {"chat.history": (["before"] if "before" in params else []), "chat.send": ["text"], "chat.approve": ["request_id", "choice"],
                      "chat.replay": ["last_seen"], "chat.react": ["row_id", "emoji"]}.get(operation, [])
            fields(params, ["session_id", *extras])
            sid = identifier(params["session_id"])
            if sid not in self.sessions:
                raise InvalidOperation("Open the managed bot first")
            await self.bot(self.sessions[sid])
            if await self.stamp(self.sessions[sid]) != self.session_incarnations.get(sid):
                raise InvalidOperation('This conversation belongs to a retired profile; open the current pebble')
            native_params = {"session_id": sid, **({"before": params["before"]} if operation == "chat.history" and "before" in params else {})}
            method = {"chat.send": "prompt.submit", "chat.stop": "session.interrupt",
                      "chat.history": "bot_web.conversation.history", "chat.approvals": "approval.pending",
                      "chat.approve": "approval.respond", "chat.replay": "session.events.since",
                      "chat.react": "message.react"}[operation]
            if operation == 'chat.react':
                from .reactions import emoji
                if type(params['row_id']) is not int or not 0 < params['row_id'] <= 9007199254740991:
                    raise InvalidOperation('Choose a saved message')
                try:
                    chosen = emoji(params['emoji'], clear=True)
                except ValueError as error:
                    raise InvalidOperation('Choose an emoji') from error
                result = await self.gateway.call(method, {**native_params, 'row_id': params['row_id'], 'emoji': chosen, 'author': 'user'})
                self.gateway._publish({'type': 'message.reaction', 'session_id': sid, 'payload': result})
                return result
            if operation == "chat.send":
                text = params["text"]
                if not isinstance(text, str) or not text.strip() or len(text) > 16000:
                    raise InvalidOperation("Invalid message")
                native_params["text"] = text
            if operation == "chat.approve":
                if params["choice"] not in {"once", "session", "always", "deny"}:
                    raise InvalidOperation("Invalid approval choice")
                pending = await self.gateway.call("approval.pending", native_params)
                request_id = identifier(params["request_id"])
                request = next((a for a in pending["approvals"] if a.get("request_id") == request_id), None)
                if request is None:
                    raise InvalidOperation("Approval is no longer pending for this bot")
                if params["choice"] not in approval_choices(request):
                    raise InvalidOperation("Hermes does not allow this approval scope")
                native_params.update(request_id=request_id, choice=params["choice"])
            if operation == "chat.replay":
                cursor = params["last_seen"]
                if type(cursor) is not int or cursor < 0:
                    raise InvalidOperation("Invalid cursor")
                native_params["last_seen"] = cursor
            result = await self.gateway.call(method, native_params)
            if operation == "chat.history" and result.get("history_unavailable"):
                raise InvalidOperation("Earlier history changed; reopen this conversation")
            if operation == "chat.approvals":
                result = {**result, "approvals": [{**row, "choices": approval_choices(row)} for row in result["approvals"]]}
            return result
        if operation == "routines.list":
            fields(params, ["profile"])
            await self.bot(params["profile"])
            return await self.gateway.call("cron.manage", {"profile": params["profile"],
                "action": "list", "include_disabled": True})
        if operation == 'routines.set_enabled':
            fields(params, ['profile', 'job_id', 'enabled'])
            await self.bot(params['profile'])
            if type(params['enabled']) is not bool:
                raise InvalidOperation('Enabled must be boolean')
            listed = await self.gateway.call('cron.manage', {'profile': params['profile'], 'action': 'list', 'include_disabled': True})
            job = next((j for j in listed.get('jobs', []) if (j.get('job_id') or j.get('id')) == params['job_id']), None)
            if not job:
                raise InvalidOperation('Routine no longer belongs to this pebble')
            result = await self.gateway.call('cron.manage', {'profile': params['profile'], 'action': 'resume' if params['enabled'] else 'pause', 'name': params['job_id']})
            if result.get('success') is not True:
                raise NativeError('Routine change was not confirmed')
            return result
        if operation == "rooms.list":
            fields(params, [])
            rooms, offset = {}, 0
            for _ in range(100):
                page = await self.gateway.call('groups.list', {'limit': 100, 'offset': offset})
                rooms.update((r['room_id'], r) for r in page.get('rooms', []))
                if page.get('next_offset') is None:
                    return {'rooms': list(rooms.values())}
                next_offset = page['next_offset']
                if type(next_offset) is not int or next_offset <= offset:
                    return {'rooms': list(rooms.values()), 'limited': True}
                offset = next_offset
            return {'rooms': list(rooms.values()), 'limited': True}
        if operation == "room.approve":
            fields(params, ["room_id", "member_id", "task_id", "execution_generation", "request_id", "choice"])
            keys = ["member_id", "task_id", "request_id"]
            checked = {key: identifier(params[key]) for key in ["room_id", *keys]}
            if type(params["execution_generation"]) is not int or params["execution_generation"] < 1 or params["choice"] not in {"once", "deny"}:
                raise InvalidOperation("Invalid room approval")
            checked.update(execution_generation=params["execution_generation"], choice=params["choice"])
            state = await self.gateway.call("groups.state", {"room_id": checked["room_id"]})
            pending = state.get("driver_status", {}).get("pending_actions", [])
            if not any(action.get("kind") == "approval" and all(action.get(key) == checked[key]
                for key in [*keys, "execution_generation"]) for action in pending):
                raise InvalidOperation("Room approval is no longer pending")
            return await self.gateway.call("groups.approve", checked)
        if operation in {"room.state", "room.log", "room.send", "room.stop"}:
            extras = {"room.log": ["since_seq"], "room.send": ["event_id", "text"]}.get(operation, [])
            fields(params, ["room_id", *extras])
            native_params = {"room_id": identifier(params["room_id"])}
            if operation == "room.log":
                if type(params["since_seq"]) is not int or params["since_seq"] < 0:
                    raise InvalidOperation("Invalid cursor")
                native_params.update(since_seq=params["since_seq"], limit=100)
            if operation == "room.send":
                text = params["text"]
                if not isinstance(text, str) or not text.strip() or len(text) > 16000:
                    raise InvalidOperation("Invalid message")
                event_id = identifier(params["event_id"])
                native_params.update(event_id=event_id, payload={"text": text, "thread_id": event_id})
            return await self.gateway.call({"room.state": "groups.state", "room.log": "groups.log",
                "room.send": "groups.send", "room.stop": "groups.stop"}[operation], native_params)
        raise InvalidOperation("Operation unavailable")
