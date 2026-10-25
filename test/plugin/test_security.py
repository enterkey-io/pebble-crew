import asyncio
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch
import os

import httpx

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("bot_web", ROOT / "plugins/bot-web/__init__.py",
    submodule_search_locations=[str(ROOT / "plugins/bot-web")])
module = importlib.util.module_from_spec(spec)
sys.modules["bot_web"] = module
spec.loader.exec_module(module)
from bot_web.server import create_app
from bot_web.operations import BotOperations, InvalidOperation
from bot_web.native import NativeGateway, NativeError

TOKEN = "s" * 43
ORIGIN = "https://app.example.test"
HOST = "hermes.example.test"


class Native:
    def __init__(self):
        self.calls = []
        self.listeners = set()

    async def call(self, method, params):
        self.calls.append((method, params))
        if method == "bot_web.runtime.verify":
            return getattr(self, "runtime", {"verified":True,"loaded":"unknown"})
        if method == "bot_web.lifecycle":
            return {"incarnation": getattr(self, "incarnation", "a"*64)}
        if method == "profiles.list":
            return {"bot_mode_protocol": True, "profiles": [
                {"name": "alpha", "ui_meta": {"hermes-bots": {"title": "Alpha"}},
                 "canonical_session": {"id": "root-alpha"}},
                {"name": "ordinary", "ui_meta": {}}]}
        if method == "session.resume":
            return {"session_id": "live-alpha", "messages": []}
        if method == "approval.pending":
            return {"approvals": [{"request_id": "alpha-request", "choices": ["once", "deny"]}]}
        return {}


class BoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.native = Native()
        self.app = create_app(TOKEN, {ORIGIN}, {HOST}, self.native)
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url=f"https://{HOST}")
        self.headers = {"Origin": ORIGIN, "Authorization": "Bearer " + TOKEN}

    async def asyncTearDown(self):
        await self.http.aclose()

    async def connected(self):
        response = await self.http.post("/v1/connect", headers=self.headers)
        return {**self.headers, "X-Bot-Connection": response.json()["connection"]}

    async def test_preflight_requires_exact_origin_but_not_bearer(self):
        response = await self.http.options("/v1/rpc", headers={"Origin": ORIGIN,
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type, x-bot-connection"})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers["access-control-allow-origin"], ORIGIN)
        self.assertNotIn("access-control-allow-credentials", response.headers)

    async def test_evil_and_null_origins_rejected_without_native_calls(self):
        for origin in ("null", "https://app.example.test.evil", "http://app.example.test", ""):
            response = await self.http.post("/v1/connect", headers={**self.headers, "Origin": origin})
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.native.calls, [])

    async def test_missing_invalid_auth_rejected(self):
        for authorization in ("", "Bearer wrong", "Basic " + TOKEN):
            response = await self.http.post("/v1/connect", headers={**self.headers, "Authorization": authorization})
            self.assertEqual(response.status_code, 401)

    async def test_dns_rebinding_host_and_query_credentials_rejected(self):
        response = await self.http.post("/v1/connect", headers={**self.headers, "Host": "attacker.test"})
        self.assertEqual(response.status_code, 403)
        response = await self.http.post("/v1/connect?token=" + TOKEN, headers=self.headers)
        self.assertEqual(response.status_code, 403)

    async def test_oversize_body_and_duplicate_auth_rejected(self):
        response = await self.http.post("/v1/rpc", content=b"x" * 65537, headers=self.headers)
        self.assertEqual(response.status_code, 413)
        response = await self.http.post("/v1/connect", headers=[("Origin", ORIGIN),
            ("Authorization", "Bearer " + TOKEN), ("Authorization", "Bearer " + TOKEN)])
        self.assertEqual(response.status_code, 400)

    async def test_raw_rpc_and_hidden_native_fields_not_forwarded(self):
        headers = await self.connected()
        for operation, params in [("profiles.configure", {"name": "alpha"}),
            ("bots.list", {"profile": "ordinary"}), ("bot.open", {"profile": "../alpha"}),
            ("chat.send", {"session_id": "live-alpha", "text": "hi", "_hosted_task": {}})]:
            response = await self.http.post("/v1/rpc", json={"operation": operation, "params": params}, headers=headers)
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.native.calls, [])

    async def test_native_open_and_session_connection_isolation(self):
        first = await self.connected()
        second = await self.connected()
        opened = await self.http.post("/v1/rpc", json={"operation": "bot.open", "params": {"profile": "alpha"}}, headers=first)
        self.assertEqual(opened.status_code, 200)
        self.assertIn(("session.resume", {"profile": "alpha", "session_id": "root-alpha"}), self.native.calls)
        response = await self.http.post("/v1/rpc", json={"operation": "chat.send", "params": {"session_id": "live-alpha", "text": "hi"}}, headers=second)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(any(method == "prompt.submit" for method, _ in self.native.calls))

    async def test_disconnect_invalidates_lease(self):
        headers = await self.connected()
        response = await self.http.delete("/v1/connect", headers=headers)
        self.assertEqual(response.status_code, 200)
        response = await self.http.post("/v1/rpc", json={"operation": "bots.list", "params": {}}, headers=headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.native.calls, [])

    async def test_bounded_connection_count(self):
        for _ in range(8):
            await self.connected()
        response = await self.http.post("/v1/connect", headers=self.headers)
        self.assertEqual(response.status_code, 429)


class ApprovalTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_session_request_and_once_or_deny_only(self):
        gateway = Native()
        ops = BotOperations(gateway)
        await ops.invoke("bot.open", {"profile": "alpha"})
        for request_id, choice in [("other-session-request", "once"), ("alpha-request", "always")]:
            with self.assertRaises(InvalidOperation):
                await ops.invoke("chat.approve", {"session_id": "live-alpha", "request_id": request_id, "choice": choice})
        self.assertFalse(any(method == "approval.respond" for method, _ in gateway.calls))
        await ops.invoke("chat.approve", {"session_id": "live-alpha", "request_id": "alpha-request", "choice": "once"})
        self.assertIn(("approval.respond", {"session_id": "live-alpha", "request_id": "alpha-request", "choice": "once"}), gateway.calls)

    async def test_room_approval_is_bound_to_native_pending_generation(self):
        class RoomNative(Native):
            async def call(self, method, params):
                if method == "groups.state":
                    return {"driver_status": {"pending_actions": [{"kind": "approval", "member_id": "alpha",
                        "task_id": "task-1", "execution_generation": 3, "request_id": "room-request"}]}}
                return await super().call(method, params)
        gateway = RoomNative()
        ops = BotOperations(gateway)
        params = {"room_id": "room-1", "member_id": "alpha", "task_id": "task-1", "execution_generation": 2,
                  "request_id": "room-request", "choice": "once"}
        with self.assertRaises(InvalidOperation):
            await ops.invoke("room.approve", params)
        self.assertFalse(any(method == "groups.approve" for method, _ in gateway.calls))
        params["execution_generation"] = 3
        await ops.invoke("room.approve", params)
        self.assertIn(("groups.approve", params), gateway.calls)


class NativeFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_bridge_credential_is_not_in_native_agent_environment(self):
        gateway = NativeGateway()
        launch = AsyncMock(return_value=object())
        with patch.dict(os.environ, {"HERMES_BOT_WEB_TOKEN": "synthetic-secret", "HERMES_BOT_WEB_ORIGINS": ORIGIN,
                                     "MODEL_API_KEY": "synthetic-provider"}), patch(
                "bot_web.native.check_native_adapter", return_value={"server_requests":False}), patch(
                "bot_web.native.asyncio.create_subprocess_exec", launch), patch.object(
                gateway, "_read", AsyncMock()), patch.object(
                gateway, "call", AsyncMock(side_effect=[{}, {"driver": True}, {"supported": True}])):
            await gateway.start()
            await gateway.reader
        env = launch.call_args.kwargs["env"]
        self.assertFalse(any(key.startswith("HERMES_BOT_WEB_") for key in env))
        self.assertEqual(env["MODEL_API_KEY"], "synthetic-provider")

    async def test_dead_native_reader_cannot_accept_more_mutations(self):
        class Output:
            async def readline(self):
                raise ValueError("Oversized frame")
        class Process:
            stdout = Output()
            returncode = None
            terminated = False
            def terminate(self):
                self.terminated = True
        gateway = NativeGateway()
        gateway.process = Process()
        gateway.healthy = True
        queue = asyncio.Queue(maxsize=1)
        gateway.listeners.add(queue)
        await gateway._read()
        self.assertFalse(gateway.healthy)
        self.assertTrue(gateway.process.terminated)
        self.assertEqual(await queue.get(), {"type": "bridge.resync"})
        with self.assertRaises(NativeError):
            await gateway.call("prompt.submit", {"session_id": "live", "text": "must not submit"})


if __name__ == "__main__":
    unittest.main()


class SessionIncarnationTests(unittest.IsolatedAsyncioTestCase):
    async def test_old_open_session_cannot_send_to_recreated_profile_name(self):
        native = Native()
        ops = BotOperations(native)
        await ops.invoke('bot.open', {'profile': 'alpha'})
        native.incarnation = 'b'*64
        before = len(native.calls)
        with self.assertRaises(InvalidOperation):
            await ops.invoke('chat.send', {'session_id': 'live-alpha', 'text': 'must not dispatch'})
        self.assertFalse(any(method == 'prompt.submit' for method, _ in native.calls[before:]))


class RuntimeAdmissionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import tempfile
        from types import SimpleNamespace
        from bot_web.workspace import WorkspaceStore
        self.directory = tempfile.TemporaryDirectory()
        self.store = WorkspaceStore(Path(self.directory.name) / 'workspace.sqlite')
        self.native = Native()
        self.app = create_app(TOKEN, {ORIGIN}, {HOST}, self.native,
                              workspace=SimpleNamespace(store=self.store, handles=lambda operation: False))
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url=f"https://{HOST}")
        self.headers = {"Origin": ORIGIN, "Authorization": "Bearer " + TOKEN}
        response = await self.http.post('/v1/connect', headers=self.headers)
        self.headers['X-Bot-Connection'] = response.json()['connection']

    async def asyncTearDown(self):
        await self.http.aclose()
        self.store.db.close()
        self.directory.cleanup()

    async def invoke(self, operation, params):
        return await self.http.post('/v1/rpc', json={'operation':operation,'params':params},headers=self.headers)

    async def test_changed_or_disabled_runtime_cannot_open_or_submit_with_or_without_attachments(self):
        opened = await self.invoke('bot.open', {'profile':'alpha'})
        self.assertEqual(opened.status_code, 200, opened.text)
        for state in ('changed', 'disabled'):
            self.native.runtime = {'verified':False,'state':state,'loaded':'unknown'}
            for operation, params in (
                ('bot.open', {'profile':'alpha'}),
                ('chat.send', {'session_id':'live-alpha','text':'must not submit'}),
                ('chat.send', {'session_id':'live-alpha','text':'must not submit','attachments':[]}),
            ):
                self.native.calls.clear()
                response=await self.invoke(operation,params)
                self.assertEqual(response.status_code,400,response.text)
                self.assertEqual(response.json()['code'],'UPDATE_REQUIRED')
                self.assertFalse(any(method in {'prompt.submit','session.resume','bot_web.runtime.prepare'} for method,_ in self.native.calls))

    async def test_opening_an_ordinary_profile_does_not_install_or_enable_a_runtime(self):
        self.native.runtime={'verified':False,'state':'absent','loaded':'unknown'}
        response=await self.invoke('bot.open',{'profile':'ordinary'})
        self.assertEqual(response.status_code,400,response.text)
        self.assertFalse(any(method in {'prompt.submit','bot_web.runtime.prepare'} for method,_ in self.native.calls))

    async def test_only_absent_runtime_is_provisioned_before_first_open_without_a_model(self):
        self.native.runtime={'verified':False,'state':'absent','loaded':'unknown'}
        original=self.native.call
        async def call(method,params):
            if method=='bot_web.runtime.prepare':
                self.native.runtime={'verified':True,'state':'verified','loaded':'unknown'}
            return await original(method,params)
        self.native.call=call
        response=await self.invoke('bot.open',{'profile':'alpha'})
        self.assertEqual(response.status_code,200,response.text)
        methods=[method for method,_ in self.native.calls]
        self.assertEqual(methods.count('bot_web.runtime.prepare'),1)
        self.assertNotIn('prompt.submit',methods)

class ApprovalScopeTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_offered_scopes_are_forwarded_for_the_exact_pending_request(self):
        class ScopedNative(Native):
            async def call(self, method, params):
                if method == 'approval.pending':
                    return {'approvals': [{'request_id': 'alpha-request', **self.policy}]}
                return await super().call(method, params)
        for policy, allowed in [({}, ['once', 'session', 'always', 'deny']),
                ({'allow_permanent': False}, ['once', 'session', 'deny']),
                ({'allow_session': False}, ['once', 'deny']),
                ({'smart_denied': True, 'choices': ['once', 'session', 'always', 'deny']}, ['once', 'deny']),
                ({'choices': ['once', 'deny']}, ['once', 'deny'])]:
            gateway = ScopedNative(); gateway.policy = policy
            ops = BotOperations(gateway)
            await ops.invoke('bot.open', {'profile': 'alpha'})
            displayed = await ops.invoke('chat.approvals', {'session_id': 'live-alpha'})
            self.assertEqual(displayed['approvals'][0]['choices'], allowed)
            for choice in ['once', 'session', 'always', 'deny']:
                edit = {'session_id': 'live-alpha', 'request_id': 'alpha-request', 'choice': choice}
                if choice in allowed:
                    await ops.invoke('chat.approve', edit)
                    self.assertIn(('approval.respond', edit), gateway.calls)
                else:
                    before = list(gateway.calls)
                    with self.assertRaises(InvalidOperation):
                        await ops.invoke('chat.approve', edit)
                    self.assertEqual([call for call in gateway.calls if call[0]=='approval.respond'],
                        [call for call in before if call[0]=='approval.respond'])
