"""Real unmodified Hermes native gateway with a deterministic local model.

All Hermes state and test messages live in an isolated temporary directory.
This proves native execution, not quality or reliability of a production model.
"""

import argparse
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
import shlex
from pathlib import Path
import sys
import tempfile
import threading
import time


def isolated_user_environment(directory):
    root = Path(directory)
    binary = root / 'fixture-bin'
    binary.mkdir(exist_ok=True)
    keychain = binary / 'security'
    keychain.write_text('#!/bin/sh\nexit 1\n')
    keychain.chmod(0o700)
    return {'HOME': str(root), 'XDG_CONFIG_HOME': str(root / '.config'),
            'CLAUDE_CONFIG_DIR': str(root / '.claude'),
            'PATH': str(binary) + ':' + os.environ.get('PATH', f'{Path(sys.executable).parent}:/usr/bin:/bin')}


def load_plugin(root):
    spec = importlib.util.spec_from_file_location("bot_web", root / "plugins/bot-web/__init__.py",
        submodule_search_locations=[str(root / "plugins/bot-web")])
    module = importlib.util.module_from_spec(spec)
    sys.modules["bot_web"] = module
    spec.loader.exec_module(module)


class Model(BaseHTTPRequestHandler):
    saw_native_tool = False
    emitted_handoff = False
    emitted_approval = False
    emitted_attachment = False
    emitted_reaction = False
    reaction_describe_requested = False
    reaction_schema_received = False
    reaction_discovery_guided = False
    saw_attachment = False
    approval_target = ""
    slow_started = threading.Event()
    correction_started = threading.Event()
    turns = 0
    tools_seen = set()
    audit_requests = False
    request_audit = []
    tool_results = []
    group_audit = None

    def log_message(self, *args):
        pass

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            # Native Stop can cancel an in-flight provider response.
            pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"object":"list","data":[{"id":"fixture-model","object":"model"}]}')

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if Model.audit_requests:
            Model.request_audit.append({'path': self.path,
                'message_count': len(data.get('messages', []))})
        # Native model capability probes may POST /show or token metadata. They
        # are not inference requests and must not be counted as replayed turns.
        Model.turns += int(self.path.endswith('/chat/completions'))
        if any(t.get("function", {}).get("name") == "message_agent" for t in data.get("tools", [])):
            Model.saw_native_tool = True
        text = "Native fixture reply"
        latest_user = next((m for m in reversed(data.get("messages", [])) if m.get("role") == "user"), {})
        if Model.group_audit is not None:
            Model.group_audit.append({'user': str(latest_user.get('content'))[:500],
                'tools': [t.get('function', {}).get('name') for t in data.get('tools', [])],
                'results': [str(m.get('content'))[:1200] for m in data.get('messages', []) if m.get('role') == 'tool'],
                'group_context': 'Recent group reactions:' in json.dumps(data)})
        if 'nativegeneratedmedia' in str(latest_user.get('content')) or 'nativedocument' in str(latest_user.get('content')):
            import re
            context = '\n'.join(str(message.get('content')) for message in data.get('messages', []))
            target = re.search(r'host-visible generated output directory (.+?) \(create it', context)
            if not target:
                evidence=Path(__file__).resolve().parents[2]/'test-results/owner/native-context-failure.json'
                evidence.parent.mkdir(parents=True,exist_ok=True)
                evidence.write_text(json.dumps(data,indent=2))
            assert target, 'Native model was not given its real media-sharing capability'
            output = Path(target[1])
            assert output.is_relative_to(Path(os.environ['HERMES_HOME']))
            output.mkdir(parents=True, exist_ok=True)
            from PIL import Image, ImageDraw
            image = Image.new('RGB', (320, 240), '#222225')
            drawing = ImageDraw.Draw(image)
            for index, height in enumerate([56, 94, 138, 172]):
                drawing.rounded_rectangle((32 + index * 68, 210 - height, 72 + index * 68, 210), radius=6, fill='#a8b99a')
            image.save(output / 'chart one.png')
            (output / 'plan.md').write_text('# Project plan\n\n**Native document proof**\n\n- Preserve existing personalities\n- Verify before release\n\n```python\nprint(42)\n```\n')
            (output / 'figures.csv').write_bytes(b'column,value\n' * 110000)
            (output / 'sample-video.mp4').write_bytes((Path(__file__).resolve().parents[2] / 'test/fixtures/sample-video.mp4').read_bytes())
            text = 'Here are the results.\n\n![Project chart](<' + str(output / 'chart one.png') + '>)\n\n[Download figures](<' + str(output / 'figures.csv') + '>)'
            text += '\n\n[Project clip](<' + str(output / 'sample-video.mp4') + '>)'
        tools = data.get("tools", [])
        tool_names = {t.get('function', {}).get('name') for t in tools}
        def can_call(name):
            return name in tool_names or 'tool_call' in tool_names
        Model.tool_results = [m.get('content') for m in data.get('messages', []) if m.get('role') == 'tool']
        if Model.reaction_describe_requested and any(
            'pebble_react' in str(result) and 'parameters' in str(result)
            for result in Model.tool_results
        ):
            Model.reaction_schema_received = True
        if any('PEBBLE_FIXTURE_FILE_INPUT' in str(m.get('content')) for m in data.get('messages', []) if m.get('role') == 'tool'):
            Model.saw_attachment = True
        import re
        reference = re.search(r'@file:(?:`([^`]+)`|"([^"]+)"|(\S+))', str(latest_user.get('content')))
        attachment = ('nativeattachment' in str(latest_user.get('content')) and reference and not Model.emitted_attachment and can_call('terminal'))
        Model.tools_seen.update(t.get("function", {}).get("name", "") for t in tools)
        handoff = ("nativehandoff" in str(latest_user.get("content"))
            and not Model.emitted_handoff
            and can_call('message_agent'))
        approval = ("nativeapproval" in str(latest_user.get("content")) and not Model.emitted_approval
            and can_call('terminal'))
        wants_reaction = self.path.endswith('/chat/completions') and 'nativereaction' in str(latest_user.get('content')) and not Model.emitted_reaction
        if wants_reaction and 'pebble_react' not in tool_names:
            Model.reaction_discovery_guided = any('tool_describe(names=["pebble_react"])' in str(m.get('content')) for m in data.get('messages', []))
        discover_reaction = (wants_reaction and 'pebble_react' not in tool_names
            and not Model.reaction_describe_requested and 'tool_describe' in tool_names
            and 'pebble_react' in json.dumps(data))
        reaction = (wants_reaction and can_call('pebble_react') and ('pebble_react' in tool_names or Model.reaction_schema_received))
        if 'nativefeedback' in str(latest_user.get('content')):
            # The reply only acknowledges feedback actually present in the model input.
            text = 'Native feedback received' if any('[The user reacted ❤️' in str(m.get('content')) for m in data.get('messages', [])) else 'Native feedback missing'
        if 'nativegroupfeedback' in str(latest_user.get('content')):
            text = 'Native group feedback received' if any('Recent group reactions:' in str(m.get('content')) and '"emoji": "❤️"' in str(m.get('content')) and '"name": "You"' in str(m.get('content')) for m in data.get('messages', [])) else 'Native group feedback missing'
        if self.path.endswith('/chat/completions') and 'nativereactiononly' in str(latest_user.get('content')):
            marker = '(pass)' if any('Recent group reactions:' in str(m.get('content')) for m in data.get('messages', [])) else 'NO_REPLY'
            assert any('On each human turn' in str(m.get('content')) and marker in str(m.get('content')) for m in data.get('messages', [])), 'Native per-turn reaction guidance missing'
            text = marker
        if "nativestop" in str(latest_user.get("content")) and can_call('message_agent'):
            Model.slow_started.set()
            time.sleep(3)
            text = "Slow fixture reply"
        if self.path.endswith('/chat/completions') and 'nativeworking' in str(latest_user.get('content')):
            Model.slow_started.set()
            time.sleep(3)
            text = 'Original fixture work'
        if 'nativecorrection' in str(latest_user.get('content')):
            if self.path.endswith('/chat/completions'):
                Model.correction_started.set()
                time.sleep(2)
            text = 'Native redirected reply'
        message = {"role": "assistant", "content": text}
        finish = "stop"
        document_turn = 'nativedocument' in str(latest_user.get('content'))
        messages = data.get('messages', [])
        latest_user_index = next((index for index in range(len(messages) - 1, -1, -1)
                                  if messages[index].get('role') == 'user'), -1)
        current_results = [message.get('content') for message in messages[latest_user_index + 1:]
                           if message.get('role') == 'tool']
        document_results = json.dumps(current_results)
        def document_receipt(value):
            if isinstance(value, str):
                try:
                    return document_receipt(json.loads(value))
                except (ValueError, TypeError):
                    return False
            if isinstance(value, dict):
                return ((value.get('requested') is True and isinstance(value.get('request_id'), str))
                        or any(document_receipt(child) for child in value.values()))
            return isinstance(value, list) and any(document_receipt(child) for child in value)
        shared_document = document_receipt(current_results)
        if document_turn and not shared_document:
            if 'pebble_open_document' not in tool_names and 'parameters' not in document_results:
                assert 'tool_describe(names=[\"pebble_open_document\"])' in json.dumps(data).replace('\\\"', '\"'), 'Document discovery guidance missing'
                name, arguments = 'tool_describe', {'names': ['pebble_open_document']}
            else:
                assert 'pebble_open_document' in json.dumps(data), 'Document tool schema missing'
                name, arguments = 'pebble_open_document', {'path': str(output / 'plan.md')}
            message = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'fixture-document', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}]}
            finish = 'tool_calls'
        elif document_turn:
            assert shared_document, document_results
            text = 'Here is the [Project plan](<' + str(output / 'plan.md') + '>).'
            message = {'role': 'assistant', 'content': text}
        elif discover_reaction:
            Model.reaction_describe_requested = True
            message = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'fixture-reaction-describe',
                'type': 'function', 'function': {'name': 'tool_describe', 'arguments': json.dumps({'names': ['pebble_react']})}}]}
            finish = 'tool_calls'
        elif reaction:
            Model.emitted_reaction = True
            name, arguments = 'pebble_react', {'emoji': '👍'}
            message = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'fixture-reaction', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}]}
            finish = 'tool_calls'
        elif attachment:
            Model.emitted_attachment = True
            path = next(group for group in reference.groups() if group)
            message = {"role": "assistant", "content": None, "tool_calls": [{"id": "fixture-file-read", "type": "function", "function": {"name": "terminal", "arguments": json.dumps({"command": "cat " + shlex.quote(path)})}}]}
            finish = 'tool_calls'
        elif handoff:
            Model.emitted_handoff = True
            message = {"role": "assistant", "content": None, "tool_calls": [{"id": "fixture-dm",
                "type": "function", "function": {"name": "message_agent", "arguments": json.dumps(
                    {"target": "beta", "message": "Teammate delivery proof"})}}]}
            finish = "tool_calls"
        elif approval:
            Model.emitted_approval = True
            message = {"role": "assistant", "content": None, "tool_calls": [{"id": "fixture-approval",
                "type": "function", "function": {"name": "terminal", "arguments": json.dumps(
                    {"command": "rm -rf " + shlex.quote(Model.approval_target)})}}]}
            finish = "tool_calls"
        if finish == 'tool_calls':
            for call in message['tool_calls']:
                function = call['function']
                if function['name'] not in tool_names and 'tool_call' in tool_names:
                    nested = {'name': function['name'], 'arguments': json.loads(function['arguments'])}
                    deferred = next(t['function'] for t in tools if t.get('function', {}).get('name') == 'tool_call')
                    arguments = {'calls': [nested]} if 'calls' in deferred.get('parameters', {}).get('properties', {}) else nested
                    call['function'] = {'name': 'tool_call', 'arguments': json.dumps(arguments)}
        output = {"id": "fixture-completion", "object": "chat.completion", "created": int(time.time()),
            "model": "fixture-model", "choices": [{"index": 0, "message": message,
            "finish_reason": finish}], "usage": {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110}}
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream" if data.get("stream") else "application/json")
        self.end_headers()
        if data.get("stream"):
            delta = {"role": "assistant", "content": text}
            if finish == 'tool_calls':
                delta = {"role": "assistant", "tool_calls": [{"index": 0, **message["tool_calls"][0]}]}
            for delta, reason in [(delta, None), ({}, finish)]:
                chunk = {**output, "object": "chat.completion.chunk", "choices": [{"index": 0,
                    "delta": delta, "finish_reason": reason}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            self.wfile.write(json.dumps(output).encode())


def seed(home, port):
    from hermes_cli.profiles import create_profile
    from hermes_state import SessionDB

    config = ("auth:\n  adopt_external_logins: false\nmodel:\n  default: fixture-model\n  provider: custom:fixture\nproviders:\n"
              f"  fixture:\n    base_url: http://127.0.0.1:{port}/v1\n    api_key: fixture-only\n"
              "agent:\n  max_turns: 3\n  bot_mode_protocol: true\n"
              "approvals:\n  mode: manual\n"
              "toolsets:\n  - terminal\n")
    (home / "config.yaml").write_text(config)
    (home / ".env").write_text("# No user credentials\n")
    for name in ("alpha", "beta"):
        path = create_profile(name, no_alias=True, no_skills=True)
        (path / "config.yaml").write_text(config)
        (path / "profile.yaml").write_text(f"name: {name}\nui_meta:\n  hermes-bots:\n    title: {name.title()}\n")
        db = SessionDB(db_path=path / "state.db")
        db.create_session(f"canonical-{name}", "cli")
        db.set_session_title(f"canonical-{name}", "Bot Chat")
        db.set_session_hidden(f"canonical-{name}", True)
        db.close()
    # An existing configured persona that has never been registered in Bot Mode.
    path = create_profile("gamma", no_alias=True, no_skills=True)
    (path / "config.yaml").write_text(config)
    (path / "SOUL.md").write_text("You are the synthetic existing Gamma researcher.\n")


async def exercise(root, home, port, *, seed_only=False):
    from hermes_state import SessionDB
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations
    seed(home, port)
    approval_target = home.parent / "approval-target"
    approval_target.mkdir()
    (approval_target / "keep.txt").write_text("Synthetic protected test file")
    Model.approval_target = str(approval_target)
    gateway = NativeGateway()
    await gateway.start()
    ops = BotOperations(gateway)
    try:
        for name in ("alpha", "beta"):
            routine = await gateway.call("cron.manage", {"profile": name, "action": "add",
                "name": f"{name}-routine", "schedule": "0 9 * * *", "prompt": "Synthetic routine", "deliver": f"bot-chat:{name}"})
            assert routine.get("success") is True
        await ops.invoke("room.create", {"room_id": "fixture-room", "name": "Team room", "profiles": ["alpha", "beta"]})
        if seed_only:
            return
        roster = await ops.invoke("bots.list", {})
        assert {bot["profile"] for bot in roster["bots"]} == {"alpha", "beta"}
        opened = await ops.invoke("bot.open", {"profile": "alpha"})
        sid = opened["session_id"]
        assert opened["canonical_id"] == "canonical-alpha"
        queue = asyncio.Queue(maxsize=256)
        gateway.listeners.add(queue)
        await ops.invoke("chat.send", {"session_id": sid, "text": "Hello native bot"})
        completed = False
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            event = await asyncio.wait_for(queue.get(), timeout=60)
            if event.get("type") == "message.complete" and event.get("session_id") == sid:
                assert event.get("payload", {}).get("status") != "error", "Real native turn failed"
                completed = True
                break
        assert completed
        history = await ops.invoke("chat.history", {"session_id": sid})
        assert any(m.get("text") == "Native fixture reply" for m in history["messages"])
        assert Model.saw_native_tool, "Actual Bot Mode message_agent tool was not injected"
        await ops.invoke("chat.send", {"session_id": sid, "text": "nativehandoff: ask beta to help"})
        deadline = time.monotonic() + 60
        delivered = False
        while time.monotonic() < deadline:
            db = SessionDB(db_path=home / "profiles/beta/state.db")
            beta_messages = db.get_messages_as_conversation("canonical-beta", include_ancestors=True)
            db.close()
            if any("Teammate delivery proof" in str(m.get("content")) for m in beta_messages):
                delivered = True
                break
            await asyncio.sleep(0.2)
        assert delivered, "Native message_agent did not deliver into beta's Bot Chat"
        async def idle():
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if not (await ops.invoke("bot.open", {"profile": "alpha"}))["running"]:
                    return
                await asyncio.sleep(0.1)
            raise AssertionError("Native bot remained running")
        await idle()
        from bot_web.attachments import AttachmentStore
        import base64
        files = AttachmentStore(home / 'bot-web' / 'file-test')
        uploaded = await files.upload(ops, 'fixture-owner', {'session_id': sid, 'name': 'fixture-input.txt', 'data': base64.b64encode(b'PEBBLE_FIXTURE_FILE_INPUT').decode()})
        native_prompt_submits=0
        actual_call=gateway.call
        async def counted_call(method,params):
            nonlocal native_prompt_submits
            if method=='prompt.submit':native_prompt_submits+=1
            return await actual_call(method,params)
        gateway.call=counted_call
        before_attachment = Model.turns
        while not queue.empty():
            queue.get_nowait()
        result = await files.submit(ops, 'fixture-owner', {'session_id': sid, 'text': 'nativeattachment: read the attached file', 'attachments': [uploaded['id']], 'request_id': 'native-file-send'})
        assert result['state'] == 'accepted'
        # Acceptance queues a turn; an immediate idle snapshot can precede its start.
        # Wait for this session's completion event before checking the tool's result.
        async with asyncio.timeout(60):
            while True:
                event = await queue.get()
                if event.get('type') == 'message.complete' and event.get('session_id') == sid:
                    assert event.get('payload', {}).get('status') != 'error', event
                    break
        await idle()
        assert Model.turns > before_attachment and Model.saw_attachment, 'Actual native tool did not read the uploaded file'
        before_retry = native_prompt_submits
        assert (await files.submit(ops, 'fixture-owner', {'session_id': sid, 'text': 'nativeattachment: read the attached file', 'attachments': [uploaded['id']], 'request_id': 'native-file-send'}))['state'] == 'accepted'
        # Other native room agents may finish concurrently; count actual submissions, not global model traffic.
        assert native_prompt_submits == before_retry, 'A repeated receipt replayed the native prompt'
        files.db.close()
        files = AttachmentStore(home / 'bot-web' / 'file-test')
        assert (await files.invoke(ops, 'fixture-owner', 'files.list', {'session_id': sid}))['files'][0]['name'] == 'fixture-input.txt'
        row, content = await files.invoke(ops, 'fixture-owner', 'files.read', {'session_id': sid, 'id': uploaded['id']})
        assert content == b'PEBBLE_FIXTURE_FILE_INPUT'
        import io
        from PIL import Image
        picture=io.BytesIO();Image.new('RGB',(8,8),'purple').save(picture,format='PNG')
        image=await files.upload(ops,'fixture-owner',{'session_id':sid,'name':'native-image.png','data':base64.b64encode(picture.getvalue()).decode()})
        assert image['kind']=='image'
        image_result=await files.submit(ops,'fixture-owner',{'session_id':sid,'text':'Native image input probe','attachments':[image['id']],'request_id':'native-image-send'})
        assert image_result['state']=='accepted'
        await idle()
        image_history=await ops.invoke('chat.history',{'session_id':sid})
        assert image['id'] in json.dumps([m for m in image_history['messages'] if m.get('role')=='user']), 'Native image did not appear in real user input history'
        files.db.close()
        print('Native file upload, tool read, reload and no-replay receipt verified')
        await ops.invoke("chat.send", {"session_id": sid, "text": "nativeapproval: require explicit permission"})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            pending = await ops.invoke("chat.approvals", {"session_id": sid})
            if pending["approvals"]:
                await ops.invoke("chat.approve", {"session_id": sid, "request_id": pending["approvals"][0]["request_id"], "choice": "deny"})
                break
            await asyncio.sleep(0.1)
        else:
            raise AssertionError(f"Native approval was not requested; emitted={Model.emitted_approval}; terminal_offered={'terminal' in Model.tools_seen}; target_exists={approval_target.exists()}")
        await idle()
        assert (approval_target / "keep.txt").exists(), "Denied action must not execute"
        await ops.invoke("chat.send", {"session_id": sid, "text": "nativestop: a cancellable native turn"})
        assert await asyncio.to_thread(Model.slow_started.wait, 10), "Slow native turn never started"
        stamp = await ops.stamp('alpha')
        guarded = await gateway.call('bot_web.lifecycle', {'action': 'delete', 'profile': 'alpha', 'incarnation': stamp})
        assert guarded['state'] == 'blocked' and (home / 'profiles/alpha').exists(), guarded
        stopped = await ops.invoke("chat.stop", {"session_id": sid})
        assert stopped.get("status") == "interrupted"
        await idle()
        room_send = await ops.invoke("room.send", {"room_id": "fixture-room", "event_id": "fixture-room-event", "text": "@alpha Begin the native discussion"})
        assert room_send.get("driver_started") is True
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            log = await ops.invoke("room.log", {"room_id": "fixture-room", "since_seq": 0})
            if any(e.get("kind") == "message.member" for e in log["events"]):
                break
            await asyncio.sleep(0.2)
        else:
            raise AssertionError("Native group driver produced no member response")
        reopened = await ops.invoke("bot.open", {"profile": "alpha"})
        assert reopened["canonical_id"] == opened["canonical_id"]
        assert any(m.get("text") == "Hello native bot" for m in reopened["messages"])
        routines = await ops.invoke("routines.list", {"profile": "alpha"})
        assert routines.get("scoped") == "alpha"
        assert {job["name"] for job in routines["jobs"]} == {"alpha-routine"}
        # Real scoped mutation and native deletion, entirely within this disposable home.
        job_id = routines['jobs'][0]['job_id']
        await ops.invoke('routines.set_enabled', {'profile': 'alpha', 'job_id': job_id, 'enabled': False})
        assert (await ops.invoke('routines.list', {'profile': 'alpha'}))['jobs'][0]['enabled'] is False
        assert (await ops.invoke('routines.list', {'profile': 'beta'}))['jobs'][0]['enabled'] is True
        await ops.invoke('routines.set_enabled', {'profile': 'alpha', 'job_id': job_id, 'enabled': True})
        from bot_web.workspace import WorkspaceStore, WorkspaceService
        from bot_web.operations import InvalidOperation
        store = WorkspaceStore(home / 'bot-web' / 'lifecycle-test.sqlite')
        service = WorkspaceService(ops, store)
        created = await gateway.call('profiles.create', {'name': 'delete-probe', 'description': 'Synthetic lifecycle check', 'soul': 'Synthetic disposable persona', 'no_alias': True, 'no_skills': True, 'clone_channels': False, 'mirror_credentials': False})
        assert created.get('ok') is True
        await ops.enable_existing('delete-probe')
        # Gamma is an existing configured persona, not a newly created profile.
        # Enrollment must preserve its model config as well as its personality.
        soul = home / 'profiles/gamma/SOUL.md'
        original_soul = soul.read_bytes()
        original_config = (home / 'profiles/gamma/config.yaml').read_bytes()
        before = await service.invoke('workspace.describe', {})
        existing = next(b for b in before['bots'] if b['profile'] == 'gamma')
        assert existing['appearance'] == {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}
        result = await service.invoke('agent.onboard', {'profile': existing['profile'], 'id': existing['id'],
            'name': 'Hazel', 'handle': 'hazel', 'appearance': {'kind': 'shape', 'shape': 'seed', 'color': 'moss'},
            'photo': None, 'role': {'title': 'Researcher', 'description': 'Investigates useful questions'},
            'expected_revision': before['revision']})
        assert result['state'] == 'completed'
        assert soul.read_bytes() == original_soul
        import yaml
        saved_config = yaml.safe_load((home / 'profiles/gamma/config.yaml').read_text())
        initial_config = yaml.safe_load(original_config)
        for key in ('model', 'providers', 'toolsets', 'approvals'):
            assert saved_config[key] == initial_config[key], key
        assert all(saved_config['agent'][key] == value for key, value in initial_config['agent'].items())
        after = await service.invoke('workspace.describe', {})
        added = next(b for b in after['bots'] if b['profile'] == existing['profile'])
        assert added['name'] == 'Hazel' and added['id'] == existing['id'] and added['canonical']
        assert added['appearance']['color'] == 'moss' and added['role']['title'] == 'Researcher'
        opened_intro = await ops.invoke('bot.open', {'profile': existing['profile']})
        while not queue.empty():
            queue.get_nowait()
        intro = await service.invoke('agent.welcome', {'profile': existing['profile'], 'id': existing['id']})
        assert intro['submitted'] is True, intro
        async with asyncio.timeout(60):
            while True:
                event = await queue.get()
                if event.get('type') == 'message.complete' and event.get('session_id') == opened_intro['session_id']:
                    assert event.get('payload', {}).get('status') != 'error', event
                    break
        intro_history = await ops.invoke('chat.history', {'session_id': opened_intro['session_id']})
        assert any(m.get('role') == 'assistant' and m.get('text') == 'Native fixture reply' for m in intro_history['messages']), intro_history
        assert all(m.get('role') != 'user' or m.get('display_kind') == 'hidden' for m in intro_history['messages']), intro_history
        again = await service.invoke('agent.welcome', {'profile': existing['profile'], 'id': existing['id']})
        assert again['submitted'] is False
        snapshot = await service.invoke('workspace.snapshot', {})
        org = await service.invoke('organization.get', {})
        members = [b['id'] for b in snapshot['workspace']['bots'] if b['profile'] in {'alpha', 'beta'}]
        assert len(members) == 2
        sections = [{**section, 'items': [item for item in section['items'] if item['kind'] != 'pebble' or item['id'] not in members]} for section in org['sections']]
        crews = [{**crew, 'members': [i for i in crew['members'] if i not in members]} for crew in org['crews']]
        crews.append({'id': 'native-review-crew', 'name': 'Native review crew', 'purpose': '', 'collapsed': False, 'members': members})
        next(s for s in sections if s['id'] == 'crews')['items'].append({'kind': 'crew', 'id': 'native-review-crew'})
        saved = await service.invoke('organization.save', {'organization': {'sections': sections, 'crews': crews}, 'expected_revision': org['revision']})
        target = {'id': 'native-review-crew', 'expected_revision': saved['revision'], 'confirm_new': False}
        crew_chat = await service.invoke('organization.chat', target)
        crew_again = await service.invoke('organization.chat', target)
        assert crew_chat['state'] == 'ready' and crew_chat['room']['room_id'] == crew_again['room']['room_id']
        assert {m['profile'] for m in crew_chat['room']['members']} == {'alpha', 'beta'}
        linked = await service.invoke('workspace.snapshot', {})
        assert linked['crew_chats']['native-review-crew'] == crew_chat['room']['room_id']
        bot = next(b for b in snapshot['workspace']['bots'] if b['profile'] == 'delete-probe')
        alpha_clock = next(b for b in snapshot['workspace']['bots'] if b['profile'] == 'alpha')
        assert alpha_clock['cursor_type'] == 'row' and alpha_clock['cursor'] > 0
        spec = {'profile': 'delete-probe', 'id': bot['id'], 'expected_revision': snapshot['workspace']['revision']}
        request_id, _ = store.request('owner', 'agent.delete', spec)
        request = next(r for r in store.requests() if r['id'] == request_id)
        approved = {'id': request_id, 'fingerprint': request['fingerprint'], 'confirmation': 'delete-probe'}
        removed = await service.invoke('requests.approve', approved)
        assert removed['state'] in {'completed', 'partial'}, removed
        if removed['state'] == 'partial':
            observed = await service.invoke('requests.reconcile', {'id': request_id})
            assert observed['target_present'] is False
            assert observed['state'] == 'partial'
        assert not (home / 'profiles/delete-probe').exists()
        try:
            await service.invoke('requests.approve', approved)
            raise AssertionError('Repeated destructive approval was accepted')
        except InvalidOperation:
            pass
        await gateway.stop()
        await gateway.start()
        assert 'delete-probe' not in {p['name'] for p in await ops.profiles()}
        recreated = await gateway.call('profiles.create', {'name': 'delete-probe', 'no_alias': True, 'no_skills': True, 'clone_channels': False, 'mirror_credentials': False})
        assert recreated.get('ok') is True
        current = await service.invoke('workspace.describe', {})
        assert next(b for b in current['bots'] if b['profile'] == 'delete-probe')['id'] != bot['id']
        store.db.close()
        print(json.dumps({"native_owner_onboarding_identity_and_hidden_intro": "pass", "native_bot_mode": "pass", "canonical_continuity": "pass",
            "native_attachment_tool_read": "pass", "native_image_history": "pass", "attachment_download_restart": "pass", "attachment_receipt_no_replay": "pass", "typed_room_creation": "pass", "persistent_native_crew_chat": "pass",
            "native_message_agent_injection": "pass", "owner_scoped_routines": "pass",
            "native_teammate_delivery": "pass", "native_room_driver_execution": "pass",
            "native_denied_approval": "pass", "native_stop": "pass",
            "native_profile_deletion_restart_name_reuse": "pass", "native_active_delete_guard": "pass", "native_read_row_clock": "pass", "native_deletion_outcome": removed["state"], "native_routine_toggle": "pass",
            "model_turns": Model.turns, "hermes_version": gateway.build["version"],
            "revision": gateway.build["revision"], "distribution_version": gateway.build["distribution_version"],
            "evidence": "real-runtime-local"}))
    finally:
        await gateway.stop()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument("--diagnostics", action="store_true")
    parser.add_argument("--owner-trust")
    parser.add_argument("--short-leases", action="store_true")
    parser.add_argument("--cert")
    parser.add_argument("--key")
    parser.add_argument("--origin", default="https://127.0.0.1:5443")
    parser.add_argument("--public-host", help="Exact Host for a disposable reverse-proxy fixture")
    args = parser.parse_args()
    root = Path(args.project)
    with tempfile.TemporaryDirectory(prefix="bot-web-native-") as directory:
        home = Path(directory) / "home"
        home.mkdir()
        # No inherited model keys or personal Hermes configuration.
        os.environ.clear()
        os.environ.update(PATH=f"{Path(sys.executable).parent}:/usr/bin:/bin",
            HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory) / "runtime"),
            PYTHONPYCACHEPREFIX=str(Path(directory) / "pycache"), PYTHONUNBUFFERED="1",
            NO_PROXY="127.0.0.1,localhost", HERMES_NO_AUTO_INSTALL="1")
        os.environ.update(isolated_user_environment(directory))
        (home / 'config.yaml').write_text('auth:\n  adopt_external_logins: false\n')
        model = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        thread = threading.Thread(target=model.serve_forever, daemon=True)
        thread.start()
        load_plugin(root)
        try:
            if args.serve:
                asyncio.run(exercise(root, home, model.server_port, seed_only=True))
                if args.owner_trust:
                    (Path(args.owner_trust).parent / 'native-home.txt').write_text(str(home))
                from bot_web.server import create_app
                import uvicorn
                if args.diagnostics:
                    from unittest.mock import patch
                    original_spawn = asyncio.create_subprocess_exec
                    async def diagnostic_spawn(*argv, **kwargs):
                        if any(str(arg).endswith('native_entry.py') for arg in argv):
                            kwargs['stderr'] = sys.stderr
                        return await original_spawn(*argv, **kwargs)
                    patch('bot_web.native.asyncio.create_subprocess_exec', diagnostic_spawn).start()
                from bot_web.trust import OwnerTrust
                trust = OwnerTrust(json.loads(Path(args.owner_trust).read_text())) if args.owner_trust else None
                hosts = {args.public_host or f"127.0.0.1:{args.port}"}
                if args.short_leases:
                    import bot_web.server as bridge_module
                    bridge_module.HEARTBEAT_SECONDS = 0.2
                    bridge_module.LEASE_SECONDS = 1
                if trust:
                    from bot_web.native import NativeGateway
                    from bot_web.operations import BotOperations
                    from bot_web.workspace import WorkspaceService, WorkspaceStore, workspace_path
                    gateway = NativeGateway()
                    workspace = WorkspaceService(BotOperations(gateway), WorkspaceStore(workspace_path()))
                    app = create_app("f" * 43, {args.origin}, hosts, gateway=gateway, trust=trust, workspace=workspace)
                    if args.short_leases:
                        # Test-only control; the bridge boundary still requires operator auth.
                        @app.post('/fixture/prepare-runtime')
                        async def prepare_runtime():
                            # Match a real plugin installation before owner first-use.
                            # No Bot Mode metadata, canonical chat or model turn is created.
                            await gateway.call('bot_web.runtime.prepare', {'profile': 'default'})
                            assert Model.turns == 0
                            return {'prepared': True, 'model_turns': Model.turns}
                        @app.post('/fixture/restart-native')
                        async def restart_native():
                            await gateway.stop()
                            await gateway.start()
                            return {'restarted': True}
                        @app.get('/fixture/busy-state')
                        async def busy_state():
                            return {'working': Model.slow_started.is_set(),
                                    'correction': Model.correction_started.is_set()}
                else:
                    app = create_app("f" * 43, {args.origin}, hosts, workspace=False)
                uvicorn.run(app, host="127.0.0.1", port=args.port, ssl_certfile=args.cert, ssl_keyfile=args.key,
                    access_log=False, proxy_headers=False, log_level="warning")
            else:
                asyncio.run(exercise(root, home, model.server_port))
        finally:
            model.shutdown()


if __name__ == "__main__":
    main()
