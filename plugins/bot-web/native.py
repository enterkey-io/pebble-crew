"""One persistent, local Hermes stdio child; never one child per browser/request."""

import asyncio
import json
import os
import re
import time
from pathlib import Path
import sqlite3
import sys
import uuid
from .compatibility import check_native_adapter


class NativeError(Exception):
    pass


class NativeGateway:
    def __init__(self):
        self.process = None
        self.pending = {}
        self.listeners = set()
        self.reader = None
        self.lock = asyncio.Lock()
        self.healthy = False
        self.build = None
        self.secrets = {}
        self.questions = {}
        self.approval_notices = {}
        self.work_supported = False

    async def has_stored_bot_chat(self, profile):
        # Read-only safety guard: native exact-title lookup hides deliberately retired
        # chats. Their absence from that lookup must never authorize replacing them.
        def read():
            from hermes_cli.profiles import get_profile_dir
            path = Path(get_profile_dir(profile)) / "state.db"
            if not path.exists():
                return False
            connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=2)
            try:
                return connection.execute("SELECT 1 FROM sessions WHERE title = ? LIMIT 1",
                    ("Bot Chat",)).fetchone() is not None
            finally:
                connection.close()
        try:
            return await asyncio.to_thread(read)
        except Exception as error:
            raise NativeError("Cannot confirm existing canonical chat state") from error

    async def start(self):
        self.build = check_native_adapter()
        # Uses the installed Hermes interpreter/modules and user's own environment.
        env = {key: value for key, value in os.environ.items() if not key.startswith("HERMES_BOT_WEB_")}
        # Normal session.resume owns interactive approval setup. Do not use watch/lazy resume.
        env["HERMES_SINGLE_QUERY_SESSION"] = ""
        self.process = await asyncio.create_subprocess_exec(
            sys.executable, str(Path(__file__).with_name("native_entry.py")),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            # Native stderr may contain tool output. Do not duplicate it in HTTP logs.
            stderr=asyncio.subprocess.DEVNULL, limit=4 * 1024 * 1024, env=env,
        )
        self.reader = asyncio.create_task(self._read())
        self.healthy = True
        # Startup handshake uses the actual native handler, not a fabricated capability.
        try:
            if self.build["server_requests"]:
                await self.call("client.capabilities", {"server_requests": True})
            await self.call("profiles.list", {"include_sessions": True})
            capabilities = await self.call("groups.capabilities", {})
            if capabilities.get("driver") is not True:
                raise NativeError("Native room driver unavailable")
            work = await self.call('bot_web.work', {'operation': 'work.capabilities', 'params': {}})
            self.work_supported = work.get('supported') is True
        except BaseException:
            await self.stop()
            raise

    async def _read(self):
        try:
            while line := await self.process.stdout.readline():
                frame = json.loads(line)
                future = self.pending.get(frame.get("id"))
                if future is not None and not future.done():
                    if "error" in frame:
                        future.set_exception(NativeError("Hermes rejected the operation"))
                    else:
                        result = frame.get("result")
                        future.set_result(result)
                        if isinstance(result, dict):
                            for request in result.get("open_requests", []) or []:
                                if isinstance(request, dict):
                                    await self._server_request(request)
                elif frame.get("method") == "event":
                    event = frame["params"]
                    if event.get('type') == 'clarify.request':
                        payload = event.get('payload', {})
                        self._capture_questions(payload.get('request_id'), event.get('session_id'), payload, legacy=True)
                        continue
                    if event.get('type') == 'clarify.expire':
                        self.questions.pop(event.get('payload', {}).get('request_id'), None)
                        self._publish({**event, 'type': 'questions.changed'})
                        continue
                    if event.get('type') == 'approval.request' and isinstance(event.get('payload', {}).get('request_id'), str):
                        ident = 'legacy:'+str(event.get('session_id'))+':'+event['payload']['request_id']
                        self.approval_notices[ident] = {'session_id': event.get('session_id'), 'request_id': event['payload']['request_id']}
                    if event.get('type') == 'message.complete':
                        sid = event.get('session_id')
                        self.questions = {key: row for key, row in self.questions.items() if row['session_id'] != sid}
                        self.approval_notices = {key: row for key, row in self.approval_notices.items() if row['session_id'] != sid}
                    if event.get('type') == 'request.cancel' and event.get('payload', {}).get('method') == 'clarify':
                        self.questions.pop(event.get('payload', {}).get('id'), None)
                        self._publish({**event, 'type': 'questions.changed'})
                        continue
                    if event.get("type") == "request.cancel" and event.get("payload", {}).get("method") == "secret":
                        self.secrets.pop(event.get("payload", {}).get("id"), None)
                        self._publish({**event, "type": "secret.changed"})
                        continue
                    if event.get("type") == "request.cancel" and event.get("payload", {}).get("method") == "approval":
                        self.approval_notices.pop(event.get('payload', {}).get('id'), None)
                        self._publish({**event, "type": "approval.request"})
                    else:
                        self._publish(event)
                elif frame.get("id") and isinstance(frame.get("method"), str):
                    await self._server_request(frame)
        except (ValueError, asyncio.LimitOverrunError):
            pass
        finally:
            self.healthy = False
            self.secrets.clear()
            self.questions.clear()
            self.approval_notices.clear()
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(NativeError("Hermes gateway disconnected"))
            for queue in tuple(self.listeners):
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait({"type": "bridge.resync"})
            self.listeners.clear()
            if self.process.returncode is None:
                self.process.terminate()

    def _publish(self, event):
        for queue in tuple(self.listeners):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                self.listeners.discard(queue)
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait({"type": "bridge.resync"})

    async def _server_request(self, frame):
        params = frame.get("params", {})
        if frame.get('method') == 'clarify' and isinstance(params, dict) and self._capture_questions(frame['id'], params.get('session_id'), params):
            return
        if frame.get("method") == "approval" and isinstance(params, dict):
            if len(self.approval_notices) < 64:
                self.approval_notices[frame['id']] = {'session_id': params.get('session_id'), 'request_id': params.get('request_id')}
            # Native approval.pending/respond remain authoritative: the browser never
            # gets a generic server-request responder or permanent/session approval.
            self._publish({"type": "approval.request", "session_id": params.get("session_id"),
                           "payload": {"request_id": params.get("request_id")}})
            return
        if frame.get("method") == "secret" and isinstance(params, dict):
            sid, env = params.get('session_id'), params.get('env_var')
            if isinstance(sid, str) and isinstance(env, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,127}', env) and len(self.secrets) < 16:
                self.secrets[frame['id']] = {'id': frame['id'], 'session_id': sid,
                    'label': env, 'prompt': str(params.get('prompt') or 'Enter this secret')[:400],
                    'expires': time.monotonic() + 295}
                self._publish({'type': 'secret.changed', 'session_id': sid})
                return
        # Decline unsupported sudo/desktop prompts instead of silently hanging
        # or inventing an answer. Never expose arbitrary request/response RPC to web.
        async with asyncio.timeout(8):
            async with self.lock:
                self.process.stdin.write((json.dumps({"jsonrpc": "2.0", "id": frame["id"],
                    "error": {"code": -32601, "message": "This client does not support this prompt"}}) + "\n").encode())
                await self.process.stdin.drain()

    def _capture_questions(self, ident, sid, params, legacy=False):
        if not isinstance(params, dict):
            return False
        questions = params.get('questions')
        single = questions is None
        if single:
            questions = [{'qid': 'q0', 'question': params.get('question'), 'choices': params.get('choices'), 'multi_select': params.get('multi_select', False)}]
        valid = isinstance(ident, str) and len(ident) <= 128 and isinstance(sid, str) and isinstance(questions, list) and 0 < len(questions) <= 16
        valid = valid and all(isinstance(q, dict) and isinstance(q.get('qid'), str) and len(q['qid']) <= 128
            and isinstance(q.get('question'), str) and len(q['question']) <= 8000
            and type(q.get('multi_select', False)) is bool
            and (q.get('choices') is None or (isinstance(q['choices'], list) and len(q['choices']) <= 32
                and all(isinstance(c, str) and len(c) <= 1000 for c in q['choices']))) for q in questions)
        valid = valid and len({q['qid'] for q in questions}) == len(questions) and isinstance(params.get('answers', {}), dict)
        if not valid or (ident not in self.questions and len(self.questions) >= 16):
            return False
        self.questions[ident] = {'id': ident, 'session_id': sid, 'questions': questions,
            'answers': params.get('answers', {}), 'legacy': legacy, 'single': single}
        self._publish({'type': 'questions.changed', 'session_id': sid})
        return True

    async def question_prompt(self, operation, params):
        from .operations import fields, InvalidOperation
        if operation == 'questions.pending':
            fields(params, ['session_id'])
            return {'requests': [row for row in self.questions.values() if row['session_id'] == params['session_id']]}
        fields(params, ['session_id', 'id', 'question_id', 'answer'])
        row = self.questions.get(params['id'])
        question = next((q for q in row['questions'] if q['qid'] == params['question_id']), None) if row else None
        answer = params['answer']
        if not row or row['session_id'] != params['session_id'] or not question:
            raise InvalidOperation('Question expired or belongs to another conversation')
        if isinstance(answer, list):
            if not question.get('multi_select') or len(answer) > 32 or not all(isinstance(a, str) and len(a) <= 4000 for a in answer):
                raise InvalidOperation('Invalid question answer')
            answer = json.dumps(answer, ensure_ascii=False)
        if answer is not None and (not isinstance(answer, str) or len(answer) > 8000):
            raise InvalidOperation('Invalid question answer')
        payload = {'request_id': row['id'], 'answer': answer}
        if not row['legacy'] or not row['single']:
            payload['question_id'] = question['qid']
        result = await self.call('clarify.respond' if row['legacy'] else 'clarify.lock', payload)
        if result.get('status') not in {'ok', 'expired'}:
            raise NativeError('Native question outcome could not be confirmed')
        if result.get('status') == 'expired' or result.get('remaining') == [] or (row['legacy'] and row['single']):
            self.questions.pop(row['id'], None)
        else:
            row['answers'][question['qid']] = answer
        self._publish({'type': 'questions.changed', 'session_id': params['session_id']})
        return {'state': 'expired' if result.get('status') == 'expired' else 'answered'}

    async def secret_prompt(self, operation, params):
        from .operations import fields, InvalidOperation
        for key in list(self.secrets):
            if self.secrets[key]['expires'] < time.monotonic():
                self.secrets.pop(key)
        if operation == 'secrets.pending':
            fields(params, ['session_id'])
            return {'requests': [{k: row[k] for k in ('id', 'label', 'prompt')} for row in self.secrets.values() if row['session_id'] == params['session_id']]}
        fields(params, ['session_id', 'id', 'value'])
        row = self.secrets.get(params['id'])
        value = params['value']
        if not row or row['session_id'] != params['session_id'] or not isinstance(value, str) or len(value) > 4096:
            raise InvalidOperation('Secret request expired or belongs to another conversation')
        # Pop under the writer lock: two windows cannot settle the same prompt.
        try:
            async with asyncio.timeout(8):
                async with self.lock:
                    if self.secrets.pop(params['id'], None) is not row:
                        raise InvalidOperation('Secret request already answered')
                    if not self.healthy or not self.process or self.process.returncode is not None:
                        raise NativeError('Hermes gateway unavailable')
                    self.process.stdin.write((json.dumps({'jsonrpc': '2.0', 'id': row['id'], 'result': {'value': value}}) + '\n').encode())
                    await self.process.stdin.drain()
        except (TimeoutError, BrokenPipeError, ConnectionError) as error:
            raise NativeError('Secret submission outcome unknown; check Hermes before retrying') from error
        self._publish({'type': 'secret.changed', 'session_id': params['session_id']})
        # The native callback, not this write, owns the subsequent save verdict.
        return {'submitted': True}

    async def call(self, method, params):
        if not self.healthy or len(self.pending) >= 32 or self.process is None or self.process.returncode is not None:
            raise NativeError("Hermes gateway unavailable")
        rid = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[rid] = future
        try:
            async with asyncio.timeout(45):
                async with self.lock:
                    if not self.healthy:
                        raise NativeError("Hermes gateway unavailable")
                    self.process.stdin.write((json.dumps({"jsonrpc": "2.0", "id": rid,
                        "method": method, "params": params}) + "\n").encode())
                    await self.process.stdin.drain()
                result = await future
                if isinstance(result, dict) and isinstance(result.get('pending_clarify'), dict):
                    pending = result['pending_clarify']
                    self._capture_questions(pending.get('request_id'), params.get('session_id') or result.get('session_id'), pending, legacy=True)
                return result
        except (TimeoutError, BrokenPipeError, ConnectionError) as error:
            # A timed-out mutation may have been accepted. Never retry automatically.
            raise NativeError("Operation outcome unknown; refresh before retrying") from error
        finally:
            self.pending.pop(rid, None)

    async def stop(self):
        if self.process is not None and self.process.returncode is None:
            self.process.stdin.close()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=8)
            except TimeoutError:
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), timeout=3)
                except TimeoutError:
                    self.process.kill()
                    await self.process.wait()
        if self.reader:
            await self.reader
