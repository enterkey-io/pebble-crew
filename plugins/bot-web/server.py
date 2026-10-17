"""User-owned bridge. Static app hosting never proxies these requests."""

import asyncio
from contextlib import asynccontextmanager, suppress
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, Response, StreamingResponse, RedirectResponse

from .native import NativeError, NativeGateway
from .operations import BotOperations, InvalidOperation
from .compatibility import check_native_adapter
from .pairing import BrowserPairing
from .version import VERSION

PROTOCOL_CATALOG = json.loads(Path(__file__).with_name('protocol-catalog.json').read_text())
ROUTES = {value['path']: value for value in PROTOCOL_CATALOG['routes'].values()}
MAX_BODY = ROUTES['/v1/rpc']['maxBytes']
LEASE_SECONDS = 1800
HEARTBEAT_SECONDS = 15


def configuration():
    token = os.environ.get("HERMES_BOT_WEB_TOKEN", "")
    # token_urlsafe(32) is 43 characters. Operators generate their own credential.
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", token):
        raise ValueError("Set HERMES_BOT_WEB_TOKEN to an independently generated random token")
    dev = os.environ.get("HERMES_BOT_WEB_LOCAL_DEV") == "1"
    origins = set(filter(None, os.environ.get("HERMES_BOT_WEB_ORIGINS", "").split(",")))
    if not origins:
        raise ValueError("Set explicit HERMES_BOT_WEB_ORIGINS")
    for origin in origins:
        parsed = urlsplit(origin)
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (parsed.scheme != "https" and not (dev and local and parsed.scheme == "http")) or (
            parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
            or not parsed.hostname or origin == "null"
        ):
            raise ValueError("Origins must be exact HTTPS origins (explicit loopback development excepted)")
    hosts = set(filter(None, os.environ.get("HERMES_BOT_WEB_HOSTS", "").split(",")))
    if not hosts or any(not re.fullmatch(r"[A-Za-z0-9.\[\]:-]+", host) for host in hosts):
        raise ValueError("Set exact HERMES_BOT_WEB_HOSTS including ports when present")
    return token, origins, hosts


def create_app(token, origins, hosts, gateway=None, trust=None, workspace=None, public_callback=None):
    native = gateway or NativeGateway()
    ops = BotOperations(native)
    if workspace is None and gateway is None:
        from .workspace import WorkspaceService, WorkspaceStore, workspace_path
        from .setup import installed_primary
        workspace = WorkspaceService(ops, WorkspaceStore(workspace_path()), primary=installed_primary())
    files = None
    if workspace:
        from pathlib import Path
        from .attachments import AttachmentStore
        state_path = Path(workspace.store.db.execute('PRAGMA database_list').fetchone()[2])
        files = AttachmentStore(state_path.parent / 'files')
    clients = {}
    from .computer import Computer
    computer = Computer(native, ops, clients, origins, hosts, enabled=os.environ.get("HERMES_BOT_WEB_EXPERIMENTAL_COMPUTER") == "1")
    pairing = BrowserPairing()
    owner_trust = trust

    @asynccontextmanager
    async def lifespan(app):
        check_native_adapter()
        await native.start()
        async def watch_roster():
            revision = None
            while True:
                await asyncio.sleep(4)
                if not workspace or not any(c.get('streaming') for c in clients.values()):
                    continue
                try:
                    snapshot = await workspace.invoke('workspace.snapshot', {})
                    if snapshot['revision'] != revision:
                        revision = snapshot['revision']
                        for queue in tuple(native.listeners):
                            try:
                                queue.put_nowait({'type': 'workspace.changed'})
                            except asyncio.QueueFull:
                                pass  # Each visible browser also reconciles periodically.
                except Exception:
                    pass  # Do not replace the last valid roster with an empty one.
        watcher = asyncio.create_task(watch_roster())
        try:
            yield
        finally:
            watcher.cancel()
            with suppress(asyncio.CancelledError):
                await watcher
            await native.stop()
            if workspace:
                workspace.store.db.close()
            if files:
                files.db.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    # ASGI middleware checks before body consumption and authenticates streams too.
    class Boundary:
        def __init__(self, app):
            self.inner = app

        async def __call__(self, scope, receive, send):
            if scope["type"] != "http":
                return await self.inner(scope, receive, send)
            headers = dict(scope["headers"])
            origin = headers.get(b"origin", b"").decode("latin1")
            host = headers.get(b"host", b"").decode("latin1")
            common = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                      "Referrer-Policy": "no-referrer", "Vary": "Origin"}
            if not origin and headers.get(b"sec-fetch-site") == b"same-origin":
                origin = next((item for item in origins if urlsplit(item).netloc == host), "")
            if origin in origins:
                common["Access-Control-Allow-Origin"] = origin
            async def reject(status):
                await JSONResponse({"error": "Request denied"}, status, headers=common)(scope, receive, send)
            # Duplicated boundary headers are ambiguous and always rejected.
            for name in (b"host", b"origin", b"authorization", b"content-length", b"x-bot-connection"):
                if sum(k == name for k, _ in scope["headers"]) > 1:
                    return await reject(400)
            callback = bool(public_callback and owner_trust and scope["method"] == "GET" and scope["path"] == "/v1/oauth/callback")
            if host not in hosts or (not callback and (origin not in origins or scope.get("query_string"))) or (callback and origin and origin not in origins):
                return await reject(403)
            if scope["method"] == "OPTIONS":
                requested = headers.get(b"access-control-request-headers", b"").decode("latin1").lower()
                names = {s.strip() for s in requested.split(",") if s.strip()}
                if headers.get(b"access-control-request-method") not in {b"POST", b"GET", b"DELETE"} or not names <= {
                    "authorization", "content-type", "x-bot-connection"
                }:
                    return await reject(403)
                common.update({"Access-Control-Allow-Methods": "POST, GET, DELETE",
                               "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Bot-Connection"})
                return await Response(status_code=204, headers=common)(scope, receive, send)
            supplied = headers.get(b"authorization", b"")
            principal = "operator" if hmac.compare_digest(supplied, ("Bearer " + token).encode()) else (
                pairing.principal(supplied[7:].decode("latin1"), origin) if supplied.startswith(b"Bearer ") else None)
            ticket = None
            if owner_trust and supplied.startswith(b"Bearer "):
                ticket = owner_trust.verify(supplied[7:].decode("latin1"), origin)
                if ticket:
                    principal = ticket["principal"]
            scope["bot.ticket_expires"] = ticket["expires"] if ticket else None
            public_pair = scope["method"] == "POST" and scope["path"] in {"/v1/pairing/request", "/v1/pairing/claim"}
            if owner_trust and public_pair:
                return await reject(403)
            if not public_pair and not callback and not principal:
                return await reject(401)
            if scope["path"] in {"/v1/pairing/approve", "/v1/pairing/revoke"} and principal != "operator":
                return await reject(403)
            scope["bot.principal"] = principal
            scope["bot.origin"] = origin
            body_limit = ROUTES.get(scope["path"], {}).get("maxBytes", MAX_BODY)
            try:
                if int(headers.get(b"content-length", b"0")) > body_limit:
                    return await reject(413)
            except ValueError:
                return await reject(400)
            consumed = 0
            async def bounded_receive():
                nonlocal consumed
                message = await receive()
                consumed += len(message.get("body", b""))
                if consumed > body_limit:
                    raise InvalidOperation("Request too large")
                return message
            async def secured_send(message):
                if message["type"] == "http.response.start":
                    message["headers"] += [(k.lower().encode(), v.encode()) for k, v in common.items()]
                await send(message)
            await self.inner(scope, bounded_receive, secured_send)

    app.add_middleware(Boundary)

    def lease(request):
        connection = request.headers.get("x-bot-connection", "")
        client = clients.get(connection)
        if client is None or time.monotonic() - client["touched"] > LEASE_SECONDS:
            clients.pop(connection, None)
            raise InvalidOperation("Reconnect to Hermes")
        if client["principal"] != request.scope.get("bot.principal"):
            raise InvalidOperation("Connection belongs to another browser")
        client["touched"] = time.monotonic()
        if request.scope.get("bot.ticket_expires"):
            client["expires"] = request.scope["bot.ticket_expires"]
        return client

    @app.exception_handler(InvalidOperation)
    async def invalid(request, error):
        return JSONResponse({"error": "Operation unavailable or invalid. Refresh and check the connection.", "code": error.code if error.code in {"STALE_REVISION", "HANDLE_TAKEN", "INVALID_REPORTING", "MODEL_UNAVAILABLE", "REQUIRES_SETUP", "INVALID_PHOTO", "INVALID_PARAMETERS", "INVALID_ATTACHMENT", "ATTACHMENT_QUOTA"} else "INVALID_PARAMETERS"}, 409 if error.code == "STALE_REVISION" else 400)

    @app.exception_handler(NativeError)
    async def native_error(request, error):
        return JSONResponse({"error": "Hermes could not confirm the operation. Refresh before retrying."}, 502)

    @app.post("/v1/connect")
    async def connect(request: Request):
        if getattr(native, "healthy", True) is False:
            return JSONResponse({"error": "Hermes is restarting. Reconnecting automatically."}, 503)
        for key in list(clients):
            idle = clients[key]
            expired = time.monotonic() - idle["touched"] > LEASE_SECONDS
            abandoned = idle["principal"] == request.scope["bot.principal"] and not idle["streaming"] and idle.get("ended") is not None and time.monotonic() - idle["ended"] > 1
            if expired or abandoned:
                clients.pop(key)
        if len(clients) >= 8:
            return JSONResponse({"error": "Connection limit reached"}, 429)
        connection = secrets.token_urlsafe(32)
        clients[connection] = {"touched": time.monotonic(), "streaming": False,
                               "inflight": 0, "sessions": set(), "principal": request.scope["bot.principal"],
                               "expires": request.scope.get("bot.ticket_expires"), "ended": None}
        build = getattr(native, "build", None) or {}
        return {"connection": connection, "protocol": "hermes-bot-web.v1", "bridge_version": VERSION,
                "capabilities": {"existing_agents": True, "owner_login": owner_trust is not None, "workspace": bool(workspace), "attachments": bool(files), "reactions": True, "computer": computer.supported},
                "hermes_version": build.get("version"), "hermes_revision": build.get("revision")}

    @app.post("/v1/renew")
    async def renew(request: Request):
        lease(request)
        return {"renewed": True}

    @app.delete("/v1/connect")
    async def disconnect(request: Request):
        client = lease(request)
        clients.pop(request.headers["x-bot-connection"], None)
        if client["principal"] != "operator":
            pairing.grants.pop(client["principal"], None)
        return {"disconnected": True}

    @app.post("/v1/files/upload")
    @app.post("/v1/files/read")
    @app.post("/v1/avatar")
    @app.post("/v1/rpc")
    async def rpc(request: Request):
        client = lease(request)
        if client["inflight"] >= 4:
            return JSONResponse({"error": "Too many pending operations"}, 429)
        client["inflight"] += 1
        try:
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                raise InvalidOperation("JSON required")
            try:
                data = await request.json()
            except (ValueError, UnicodeDecodeError) as error:
                raise InvalidOperation("Invalid JSON") from error
            if not isinstance(data, dict) or set(data) != {"operation", "params"}:
                raise InvalidOperation("Invalid request")
            operation, params = data["operation"], data["params"]
            if not isinstance(operation, str) or not isinstance(params, dict):
                raise InvalidOperation("Invalid operation")
            definition = PROTOCOL_CATALOG['operations'].get(operation)
            if not definition or not any(PROTOCOL_CATALOG['routes'][name]['path'] == request.url.path
                                         for name in definition['accepted']):
                raise InvalidOperation('Operation unavailable on this route')
            if (operation.startswith("chat.") or operation.startswith("files.")) and params.get("session_id") not in client["sessions"]:
                raise InvalidOperation("Session belongs to another connection")
            if operation.startswith('computer.'):
                result = await computer.invoke(operation, params, client, request.headers['x-bot-connection'])
            elif operation.startswith('files.'):
                if not files:
                    raise InvalidOperation('Attachments unavailable')
                if operation == 'files.upload':
                    result = await files.upload(ops, client['principal'], params)
                elif operation == 'files.read':
                    row, blob = await files.invoke(ops, client['principal'], operation, params)
                    from urllib.parse import quote
                    return Response(blob, media_type='application/octet-stream', headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(row['name'], safe='')})
                elif operation in {'files.list', 'files.remove', 'files.reconcile', 'files.discard'}:
                    result = await files.invoke(ops, client['principal'], operation, params)
                else:
                    raise InvalidOperation('Attachment operation unavailable')
            elif operation in {'search.query', 'search.context'}:
                if not workspace:
                    raise InvalidOperation('Owner-local search unavailable')
                from .search import query, context
                result = await (query if operation == 'search.query' else context)(workspace, files, client['principal'], params)
            elif operation == 'chat.send':
                if files and 'attachments' in params:
                    result = await files.submit(ops, client['principal'], params)
                else:
                    if files:
                        state = await files.invoke(ops, client['principal'], 'files.reconcile', {'session_id': params.get('session_id')})
                        if state['state'] == 'uncertain':
                            raise NativeError('Check the previous attachment send before sending again')
                    result = await ops.invoke(operation, params)
            elif operation in {"connections.auth_start", "connections.auth_status", "connections.auth_cancel"}:
                if not public_callback or not owner_trust:
                    raise InvalidOperation("Owner enrollment and a fixed HTTPS callback are required")
                required = {"profile", "name"} if operation.endswith("start") else {"id"}
                if set(params) != required:
                    raise InvalidOperation("Invalid authorization request")
                action = {"connections.auth_start": "start", "connections.auth_status": "status", "connections.auth_cancel": "cancel"}[operation]
                result = await native.call("bot_web.connections.oauth", {**params, "action": action, **({"callback": public_callback} if action == "start" else {})})
            else:
                result = await (workspace.invoke(operation, params) if workspace and workspace.handles(operation) else ops.invoke(operation, params))
            if operation == "bot.open":
                client["sessions"].add(result["session_id"])
            return {"result": result}
        except (TypeError, KeyError, ValueError) as error:
            raise InvalidOperation("Invalid operation values") from error
        finally:
            client["inflight"] -= 1

    @app.websocket("/v1/computer/stream")
    async def computer_stream(websocket: WebSocket):
        await computer.stream(websocket)

    @app.get("/v1/oauth/callback")
    async def oauth_callback(request: Request):
        if not public_callback or not owner_trust:
            raise InvalidOperation("Authorization is unavailable")
        pairs = list(request.query_params.multi_items())
        if len(pairs) > 4 or len({k for k, _ in pairs}) != len(pairs) or any(k not in {"code", "state", "error", "iss"} or not v or len(v) > 4096 for k, v in pairs):
            raise InvalidOperation("Invalid authorization callback")
        data = dict(pairs)
        if not data.get("state") or bool(data.get("code")) == bool(data.get("error")):
            raise InvalidOperation("Invalid authorization callback")
        await native.call("bot_web.connections.oauth", {"action": "callback", "id": None, **{key: data.get(key) for key in ["code", "state", "error", "iss"]}})
        # Strip provider query values from the visible URL and never reflect them in HTML/logs.
        return RedirectResponse(owner_trust.value["origin"], status_code=303)

    @app.get("/v1/events")
    async def events(request: Request):
        client = lease(request)
        if client["streaming"]:
            return JSONResponse({"error": "Event stream already active"}, 409)
        client["streaming"] = True
        queue = asyncio.Queue(maxsize=256)
        native.listeners.add(queue)
        connection = request.headers["x-bot-connection"]
        def active():
            return (clients.get(connection) is client
                    and time.monotonic() - client["touched"] <= LEASE_SECONDS
                    and ((client.get("expires") is not None and time.time() < client["expires"])
                         or (client.get("expires") is None and pairing.alive(client["principal"]))))
        async def stream():
            try:
                # Flush headers immediately and acknowledge an authenticated stream.
                yield '{"type":"bridge.ready"}\n\n'
                next_heartbeat = time.monotonic() + HEARTBEAT_SECONDS
                while active():
                    # Filtered native traffic must not restart the browser's heartbeat clock.
                    remaining = next_heartbeat - time.monotonic()
                    if remaining <= 0:
                        # An authenticated, actively streamed browser is not idle. Ticket/grant
                        # expiry remains an independent hard boundary; heartbeats never extend it.
                        client["touched"] = time.monotonic()
                        yield '{"type":"bridge.heartbeat"}\n\n'
                        next_heartbeat = time.monotonic() + HEARTBEAT_SECONDS
                        continue
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=remaining)
                    except TimeoutError:
                        continue
                    if not active():
                        break
                    if event.get("type") == "bridge.resync":
                        yield json.dumps(event) + "\n\n"
                        break
                    if event.get('type') == 'workspace.changed':
                        yield '{"type":"workspace.changed"}\n\n'
                        continue
                    if event.get("session_id") in client["sessions"]:
                        yield json.dumps(event, ensure_ascii=False) + "\n\n"
            finally:
                native.listeners.discard(queue)
                client["streaming"] = False
                client["ended"] = time.monotonic()
        return StreamingResponse(stream(), media_type="application/x-ndjson",
                                 headers={"X-Accel-Buffering": "no"})

    async def pairing_body(request, required):
        if request.headers.get("content-type", "").split(";")[0] != "application/json":
            raise InvalidOperation("JSON required")
        try:
            data = await request.json()
        except ValueError as error:
            raise InvalidOperation("Invalid JSON") from error
        if not isinstance(data, dict) or set(data) != set(required):
            raise InvalidOperation("Invalid pairing request")
        return data

    @app.post("/v1/pairing/request")
    async def request_pairing(request: Request):
        data = await pairing_body(request, ["challenge"])
        return pairing.request(request.scope["bot.origin"], data["challenge"])

    @app.post("/v1/pairing/claim")
    async def claim_pairing(request: Request):
        data = await pairing_body(request, ["request_id", "verifier"])
        return pairing.claim(data["request_id"], data["verifier"], request.scope["bot.origin"])

    @app.post("/v1/pairing/approve")
    async def approve_pairing(request: Request):
        data = await pairing_body(request, ["code"])
        return pairing.approve(data["code"], request.scope["bot.origin"])

    @app.post("/v1/pairing/revoke")
    async def revoke_pairing(request: Request):
        data = await pairing_body(request, ["all"])
        if data["all"] is not True:
            raise InvalidOperation("Global revocation requires all: true; use DELETE /v1/connect for probe cleanup")
        pairing.revoke()
        clients.clear()
        return {"revoked": True}

    return app


def serve():
    import uvicorn
    from .setup import read_settings, config_path
    if not config_path().exists() and os.environ.get("HERMES_BOT_WEB_TOKEN"):
        token, origins, hosts = configuration()
        port = int(os.environ.get("HERMES_BOT_WEB_PORT", "8788"))
    else:
        settings = read_settings()
        token, origins, hosts = settings["token"], set(settings["origins"]), {settings["host"]}
        port = settings["port"]
    from .trust import OwnerTrust
    trust = OwnerTrust.installed()
    if trust and "settings" not in locals():
        raise ValueError("Owner enrollment requires persistent bridge settings")
    # Bind loopback only. Remote HTTPS uses a user-owned reverse proxy/tunnel.
    callback = settings["bridge_url"] + "/v1/oauth/callback" if trust else None
    uvicorn.run(create_app(token, origins, hosts, trust=trust, public_callback=callback), host="127.0.0.1", port=port,
                access_log=False, proxy_headers=False, log_level="warning")
