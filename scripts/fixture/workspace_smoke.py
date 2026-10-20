"""Real native workspace enrollment/metadata/persona and plugin tool fixture.
Only disposable homes and a deterministic loopback model; no owner/provider access.
"""
import asyncio
from http.server import ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import threading
from native_smoke import Model, load_plugin, isolated_user_environment

ROOT = Path(__file__).resolve().parents[2]


def has_applied_reporting(value, depth=0):
    if depth > 12:
        return False
    if isinstance(value, dict):
        if any(c.get('state') == 'applied' and c.get('change', {}).get('profile') == 'engineer'
               for c in value.get('reporting_changes', []) if isinstance(c, dict)):
            return True
        return any(has_applied_reporting(v, depth + 1) for v in value.values())
    if isinstance(value, list):
        return any(has_applied_reporting(v, depth + 1) for v in value)
    if isinstance(value, str):
        try:
            return has_applied_reporting(json.loads(value), depth + 1)
        except (ValueError, TypeError):
            return False
    return False


class WorkspaceModel(Model):
    requests = []
    proposed = False
    described = False
    handed = False
    room_handed = False
    live_requests = []
    reporting_step = 0
    reporting_applied = False

    def do_POST(self):
        payload = self.rfile.read(int(self.headers['Content-Length']))
        data = json.loads(payload)
        if self.path == '/v1/live/sessions':
            self.live_requests.append(data)
            response = json.dumps({'session': {'id': 'synthetic-live'}, 'transport': {'type': 'webrtc', 'sdp': 'v=0\r\nsynthetic-answer\r\n'}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(response)
            return
        self.requests.append(data)
        names = {t.get('function', {}).get('name') for t in data.get('tools', [])}
        user = str(next((m.get('content') for m in reversed(data.get('messages', [])) if m.get('role') == 'user'), ''))
        name, arguments, reply = None, None, None
        if 'Synthetic org update' in user:
            step = WorkspaceModel.reporting_step
            WorkspaceModel.reporting_step += 1
            if step == 0:
                if 'tool_describe' in names:
                    name, arguments = 'tool_describe', {'names': ['workspace_agents']}
                else:
                    # This conversation may already carry the enabled schema
                    # from its earlier enrollment proposal.
                    assert 'workspace_agents' in names and 'agent.reporting.update' in json.dumps(data['tools'])
                    WorkspaceModel.reporting_step += 1
                    name, arguments = 'workspace_agents', {'action': 'describe', 'spec': {}}
            elif step == 1:
                assert 'agent.reporting.update' in json.dumps(data), 'Deferred reporting schema not received'
                name, arguments = 'workspace_agents', {'action': 'describe', 'spec': {}}
            elif step == 2:
                marker = 'Current owner workspace metadata (not a replacement for your SOUL):\n'
                contents = [m.get('content') for m in data.get('messages', [])]
                context = max((json.JSONDecoder().raw_decode(c.rsplit(marker, 1)[1])[0]
                    for c in contents if isinstance(c, str) and marker in c), key=lambda c: c['workspace_revision'])
                engineer = next(b for b in context['directory'] if b['profile'] == 'engineer')
                assert context['management']['can_manage'] is True
                assert context['management']['ask_before_unsolicited_changes'] is True
                assert context['management']['owner_request_authorizes_change'] is True
                assert 'A clear owner request already authorizes that change' in context['instructions']
                name, arguments = 'workspace_agents', {'action':'agent.reporting.update', 'spec':{
                    'profile':'engineer', 'id':engineer['id'], 'manager':'default',
                    'manager_id':context['main_pebble']['id'],
                    'instructions':'SYNTHETIC_REPORTING_INSTRUCTIONS: verify the result and report blockers to Aurora.',
                    'expected_revision':context['workspace_revision'], 'policy_revision':context['management']['policy_revision']}}
            elif has_applied_reporting(data):
                WorkspaceModel.reporting_applied = True
                reply = 'Synthetic org management applied'
            else:
                time.sleep(0.35)
                name, arguments = 'workspace_agents', {'action':'describe','spec':{}}
        elif 'Synthetic room routing proof' in user and 'SYNTHETIC_EXISTING_AURORA_PERSONALITY' in json.dumps(data.get('messages', [])):
            WorkspaceModel.room_handed = True
            reply = '@maker Room handoff proof'
        if 'Synthetic org update' in user:
            pass
        elif 'Synthetic public-handle handoff' in user and not WorkspaceModel.handed and 'message_agent' in names:
            WorkspaceModel.handed = True
            name, arguments = 'message_agent', {'target': 'maker', 'message': 'Public handle routing proof'}
        elif 'Synthetic new-agent model verification' in user and not WorkspaceModel.described:
            WorkspaceModel.described = True
            name, arguments = 'workspace_agents', {'action': 'describe', 'spec': {}}
            if name not in names and 'tool_call' in names:
                name, arguments = 'tool_call', {'calls': [{'name': name, 'arguments': arguments}]}
        elif not WorkspaceModel.proposed and 'workspace_agents' in names:
            WorkspaceModel.proposed = True
            name, arguments = 'workspace_agents', {'action': 'agent.enable', 'spec': {'profile': 'engineer', 'initialize_chat': True}}
        if name and name not in names and 'tool_call' in names:
            definition = next(t['function'] for t in data['tools'] if t.get('function', {}).get('name') == 'tool_call')
            nested = {'name': name, 'arguments': arguments}
            arguments = {'calls': [nested]} if 'calls' in definition.get('parameters', {}).get('properties', {}) else nested
            name = 'tool_call'
        if name or reply:
            message = {'role': 'assistant', 'content': reply} if reply else {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'workspace-propose-'+str(len(self.requests)), 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}]}
            reason = 'stop' if reply else 'tool_calls'
            response = {'created': int(time.time()), 'id': 'fixture-proposal', 'object': 'chat.completion', 'model': 'fixture-model', 'choices': [{'index': 0, 'message': message, 'finish_reason': reason}], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream' if data.get('stream') else 'application/json')
            self.end_headers()
            if data.get('stream'):
                delta = message if reply else {'role': 'assistant', 'tool_calls': [{'index': 0, **response['choices'][0]['message']['tool_calls'][0]}]}
                for part, finish in [(delta, None), ({}, reason)]:
                    chunk = {**response, 'object': 'chat.completion.chunk', 'choices': [{'index': 0, 'delta': part, 'finish_reason': finish}]}
                    self.wfile.write(('data: ' + json.dumps(chunk) + '\n\n').encode())
                self.wfile.write(b'data: [DONE]\n\n')
            else:
                self.wfile.write(json.dumps(response).encode())
            return
        self.rfile = io.BytesIO(payload)
        super().do_POST()


async def verify(home, model_port):
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations, InvalidOperation
    from bot_web.workspace import WorkspaceStore, WorkspaceService
    native = NativeGateway()
    await native.start()
    store = WorkspaceStore(home / 'bot-web' / 'workspace.sqlite')
    ops = BotOperations(native)
    workspace = WorkspaceService(ops, store)
    try:
        await native.call('profiles.create', {'name': 'engineer', 'no_alias': True, 'no_skills': True, 'mirror_credentials': False})
        existing_model = await native.call('bot_web.models', {'action': 'describe'})
        await native.call('bot_web.models', {'action': 'grant', 'profile': 'engineer', 'expected': existing_model['fingerprint']})
        soul = (home / 'SOUL.md').read_bytes()
        detection = await workspace.invoke('workspace.detect_primary', {})
        assert detection['profile'] == 'default', detection
        initialized = await workspace.invoke('workspace.initialize', {'profile': 'default', 'handle': 'aurora', 'appearance': {'kind': 'shape', 'shape': 'petal', 'color': 'white'}, 'photo': None, 'expected_revision': detection['revision']})
        assert initialized['initialized'] and initialized['orchestrator'] == 'default'
        assert Model.turns == 0
        assert (home / 'SOUL.md').read_bytes() == soul
        root = next(b for b in initialized['bots'] if b['profile'] == 'default')
        # Round-trip native metadata merge preserves unrelated/unknown namespace fields.
        await workspace.mirror('default', {'fixtureUnknown': {'keep': True}})
        await workspace.invoke('bots.update_handle', {'profile': 'default', 'handle': 'aurora', 'expected_revision': initialized['revision']})
        roster = await ops.profiles()
        assert next(r for r in roster if r['name'] == 'default')['ui_meta']['hermes-bots']['fixtureUnknown'] == {'keep': True}
        opened = await ops.invoke('bot.open', {'profile': 'default'})
        queue = asyncio.Queue()
        native.listeners.add(queue)
        await ops.invoke('chat.send', {'session_id': opened['session_id'], 'text': 'Synthetic workspace tool and context verification'})
        async with asyncio.timeout(60):
            while True:
                event = await queue.get()
                if event.get('type') == 'message.complete' and event.get('session_id') == opened['session_id']:
                    break
        all_payloads = json.dumps(WorkspaceModel.requests)
        assert 'workspace_agents' in all_payloads, 'Plugin tool not exposed to native model'
        assert 'Current owner workspace metadata' in all_payloads and '@aurora' in all_payloads, 'Live identity missing from native turn'
        requests = store.requests()
        if not requests:
            print(json.dumps({'history': await ops.invoke('chat.history', {'session_id': opened['session_id']}), 'fixture_tool_names': [[t.get('function',{}).get('name') for t in r.get('tools',[])] for r in WorkspaceModel.requests], 'fixture_tool_results': [m for r in WorkspaceModel.requests for m in r.get('messages', []) if m.get('role') == 'tool']}))
        assert len(requests) == 1 and requests[0]['actor'] == 'default' and requests[0]['state'] == 'pending', requests
        assert not any(r['name'] == 'engineer' for r in await ops.roster()), 'Model proposal executed before owner approval'
        approved = await workspace.invoke('requests.approve', {'id': requests[0]['id'], 'fingerprint': requests[0]['fingerprint']})
        assert approved['state'] == 'completed', approved
        assert any(r['name'] == 'engineer' for r in await ops.roster())
        # An actual deferred native tool controls an existing agent without an owner
        # approval or browser. Only the deterministic loopback model receives this.
        from bot_web.reporting import drain, receipts
        async def apply_reporting():
            while True:
                await asyncio.sleep(0.1)
                await drain(workspace)
        worker = asyncio.create_task(apply_reporting())
        try:
            await ops.invoke('chat.send', {'session_id': opened['session_id'], 'text':'Synthetic org update'})
            async with asyncio.timeout(60):
                while True:
                    event = await queue.get()
                    if event.get('type') == 'message.complete' and event.get('session_id') == opened['session_id']:
                        break
            assert receipts(store)[0]['state'] == 'applied', receipts(store)
            assert store.read()['bots']['engineer']['manager'] == 'default'
            assert 'SYNTHETIC_REPORTING_INSTRUCTIONS' in store.read()['bots']['engineer']['role']['responsibilities']
            assert WorkspaceModel.reporting_step >= 3 and WorkspaceModel.reporting_applied, 'Native model did not observe an applied receipt after schema discovery'
        finally:
            worker.cancel()
            try:
                await worker
            except asyncio.CancelledError:
                pass
        # Genuinely new native identity, with one explicitly approved model grant.
        current = await workspace.invoke('workspace.describe', {})
        model = current['model_grant']
        assert model['supported'] is True, model
        # An ordinary existing profile receives the same explicit root in its
        # real introduction and model context, even when job titles differ.
        await native.call('bot_web.models', {'action': 'grant', 'profile': 'engineer', 'expected': model['fingerprint']})
        engineer = next(b for b in current['bots'] if b['profile'] == 'engineer')
        start = len(WorkspaceModel.requests)
        greeting = await workspace.invoke('agent.welcome', {'profile': 'engineer', 'id': engineer['id']})
        assert greeting['state'] == 'accepted', greeting
        async with asyncio.timeout(60):
            while True:
                event = await queue.get()
                if event.get('type') == 'message.complete' and ops.sessions.get(event.get('session_id')) == 'engineer':
                    break
        contexts = []
        for request in WorkspaceModel.requests[start:]:
            for message in request.get('messages', []):
                content = message.get('content')
                marker = 'Current owner workspace metadata (not a replacement for your SOUL):\n'
                if isinstance(content, str) and marker in content:
                    value, _ = json.JSONDecoder().raw_decode(content.rsplit(marker, 1)[1])
                    if value.get('native_profile') == 'engineer':
                        contexts.append(value)
        assert contexts, 'Existing agent introduction did not receive live hierarchy'
        assert all(c['main_pebble']['handle'] == '@aurora' and c['your_manager'] == c['main_pebble'] for c in contexts), contexts
        assert all([p['handle'] for p in c['your_reporting_path']] == ['@engineer', '@aurora'] for c in contexts), contexts
        assert '@aurora is the Main Pebble' in json.dumps(WorkspaceModel.requests[start:]), 'Welcome omitted actual root'
        # The modern native Live helpers, actual profile secret lifecycle and
        # normal model turn, with signaling only to this deterministic localhost.
        from bot_web.live_voice import LiveVoice, supported as supports_live
        if supports_live():
            from hermes_cli.web_server_profiles import _config_profile_scope
            from hermes_cli.config import read_user_config_raw, save_config
            with _config_profile_scope('default'):
                config = read_user_config_raw() or {}
                config.setdefault('voice', {}).setdefault('gpt_live', {})['base_url'] = 'http://127.0.0.1:' + str(model_port) + '/v1'
                save_config(config)
            with _config_profile_scope('engineer'):
                config = read_user_config_raw() or {}
                config.setdefault('auxiliary', {})['voice_chat'] = {'model': 'must-not-use-auxiliary-voice-reasoner'}
                config.setdefault('voice', {}).setdefault('gpt_live', {})['base_url'] = 'http://127.0.0.1:' + str(model_port) + '/v1'
                save_config(config)
            voice = LiveVoice(ops)
            engineer_chat = await ops.invoke('bot.open', {'profile': 'engineer'})
            sid = engineer_chat['session_id']
            before_env = (home / '.env').read_bytes()
            status = await voice.invoke('voice.status', {'session_id': sid})
            assert status['supported'] and not status['configured'], status
            assert (await voice.invoke('voice.credential', {'session_id': sid, 'value': 'synthetic-voice-only-key'})) == {'saved': True, 'validated': False}
            status = await voice.invoke('voice.status', {'session_id': sid})
            assert status['configured'], status
            status = await voice.invoke('voice.preferences', {'session_id': sid, 'voice': status['voices'][0], 'complete': False})
            assert status['voice'] == status['voices'][0] and 'speed' not in status and status['key_confirmed'] and not status['setup_complete'], status
            assert (await voice.invoke('voice.status', {'session_id': sid}))['key_confirmed'], 'Saved-key confirmation was lost between voice entry points'
            status = await voice.invoke('voice.preferences', {'session_id': sid, 'voice': status['voices'][1], 'complete': True})
            assert 'speed' not in status and status['setup_complete'], status
            for preview in (True, False):
                answer = await voice.invoke('voice.session', {'session_id': sid, 'sdp': 'v=0\r\nsynthetic-offer\r\n', 'preview': preview})
                assert answer['transport']['sdp'] == 'v=0\r\nsynthetic-answer\r\n'
                sent = WorkspaceModel.live_requests[-1]
                assert sent['transport']['sdp'] == 'v=0\r\nsynthetic-offer\r\n'
                assert sent['session']['audio']['output']['voice'] == status['voice']
                assert '[Pebble Crew delivery]' not in sent['session']['instructions']
                assert 'synthetic-voice-only-key' not in json.dumps(sent)
            assert before_env in (home / '.env').read_bytes(), 'Voice credential changed unrelated primary secrets'
            with _config_profile_scope('default'):
                from hermes_cli.config import load_env
                assert load_env()['VOICE_TOOLS_OPENAI_KEY'] == 'synthetic-voice-only-key'
            assert (await voice.invoke('voice.status', {'session_id': opened['session_id']}))['key_confirmed'], 'Primary did not reuse the approved shared voice account'
            start = len(WorkspaceModel.requests)
            accepted = await voice.invoke('voice.submit', {'session_id': sid, 'text': 'Synthetic live voice request', 'context': 'User: check this synthetic request'})
            assert type(accepted.get('user_row_id')) is int, accepted
            async with asyncio.timeout(60):
                while True:
                    event = await queue.get()
                    if event.get('type') == 'message.complete' and event.get('session_id') == sid:
                        receipt = event.get('payload', {}).get('persisted_turn', {})
                        assert receipt.get('user_row_id') == accepted['user_row_id'], event
                        assert type(receipt.get('final_assistant_row_id')) is int, event
                        break
            assert WorkspaceModel.requests[start:] and all(r.get('model') == 'fixture-model' for r in WorkspaceModel.requests[start:])
            assert 'live spoken conversation' in json.dumps(WorkspaceModel.requests[start:]), 'Native Live surface note omitted'
            followup = await voice.invoke('voice.end', {'session_id': sid, 'call_id': 'synthetic-live', 'transcript': 'User: We could change the project next week. No decision yet.\nAssistant: We can decide later.'})
            assert followup['submitted'] is True
            assert await voice.invoke('voice.end', {'session_id': sid, 'call_id': 'synthetic-live', 'transcript': 'replay'}) == {'submitted': False}
            async with asyncio.timeout(60):
                while True:
                    event = await queue.get()
                    if event.get('type') == 'message.complete' and event.get('session_id') == sid and event.get('payload', {}).get('persisted_turn', {}).get('user_row_id') == followup['user_row_id']:
                        break
            history = await ops.invoke('chat.history', {'session_id': sid})
            assert not any(str(row.get('row_id')) == str(followup['user_row_id']) or 'The live voice call has ended' in str(row.get('text', '')) for row in history['messages']), 'Call-end instruction became a visible owner message'
        # Native completion is profile/session scoped and does not invoke a model.
        from bot_web.commands import invoke as command
        command_chat = await ops.invoke('bot.open', {'profile': 'engineer'})
        command_sid = command_chat['session_id']
        before_commands = len(WorkspaceModel.requests)
        available = await command(ops, 'chat.commands', {'session_id': command_sid, 'text': '/'})
        assert any(item['text'].strip().lstrip('/') == 'model' for item in available['items']), available
        receipt = await command(ops, 'chat.command', {'session_id': command_sid, 'text': '/model fixture-model-command --session --provider custom:fixture'})
        assert isinstance(receipt['output'], str) and receipt['output'], receipt
        assert not any(request.get('messages') or request.get('input') for request in WorkspaceModel.requests[before_commands:]), 'Native command was submitted as a model prompt'
        status = await native.call('session.status', {'session_id': command_sid})
        assert 'fixture-model-command' in status['output'], status
        await command(ops, 'chat.command', {'session_id': command_sid, 'text': '/model fixture-model --session --provider custom:fixture'})
        current = await workspace.invoke('workspace.describe', {})
        created = await workspace.invoke('agent.create', {'name': 'new-researcher', 'display_name': 'New Researcher', 'soul': 'SYNTHETIC_NEW_RESEARCHER_PERSONALITY', 'role': 'Research synthetic fixtures', 'model_source': 'default', 'model_fingerprint': model['fingerprint'], 'skills': [], 'toolsets': ['workspace', 'skills'], 'manager': 'default', 'team': None, 'expected_revision': current['revision']})
        assert created['state'] == 'completed', created
        from hermes_cli.profiles import get_profile_dir
        created_home = Path(get_profile_dir('new-researcher'))
        assert (created_home / 'SOUL.md').read_text() == 'SYNTHETIC_NEW_RESEARCHER_PERSONALITY'
        assert 'UNRELATED_TEST_KEY' not in (created_home / '.env').read_text()
        capabilities = await native.call('profiles.describe', {'name': 'new-researcher'})
        from agent.skill_utils import ESSENTIAL_SKILLS
        assert {s['name'] for s in capabilities['skills'] if s['enabled']} <= ESSENTIAL_SKILLS, 'Fresh bot inherited optional skills'
        new_chat = await ops.invoke('bot.open', {'profile': 'new-researcher'})
        await ops.invoke('chat.send', {'session_id': new_chat['session_id'], 'text': 'Synthetic new-agent model verification'})
        async with asyncio.timeout(60):
            while True:
                event = await queue.get()
                if event.get('type') == 'message.complete' and event.get('session_id') == new_chat['session_id']:
                    if event.get('payload', {}).get('status') == 'error':
                        import hermes_yaml as yaml
                        saved = yaml.safe_load((created_home / 'config.yaml').read_text()) or {}
                        print(json.dumps({'synthetic_target_model': saved.get('model'), 'synthetic_provider_config': {key: {field: value for field, value in definition.items() if field not in {'api_key', 'token', 'password'}} for key, definition in (saved.get('providers') or {}).items()}}))
                    assert event.get('payload', {}).get('status') != 'error', event
                    break
        assert 'Native fixture reply' in json.dumps(await ops.invoke('chat.history', {'session_id': new_chat['session_id']}))
        assert 'SYNTHETIC_NEW_RESEARCHER_PERSONALITY' in json.dumps(WorkspaceModel.requests)
        assert (home / 'SOUL.md').read_bytes() == soul
        assert 'native_profile\\\": \\\"new-researcher' in json.dumps(WorkspaceModel.requests) or any('new-researcher' in str(m.get('content')) for r in WorkspaceModel.requests for m in r.get('messages', []) if m.get('role') == 'tool'), 'Named caller did not receive its own context'
        current = await workspace.invoke('workspace.describe', {})
        await workspace.invoke('bots.update_handle', {'profile': 'new-researcher', 'handle': 'maker', 'expected_revision': current['revision']})
        root_chat = await ops.invoke('bot.open', {'profile': 'default'})
        handoff_events = asyncio.Queue()
        native.listeners.add(handoff_events)
        try:
            await ops.invoke('chat.send', {'session_id': root_chat['session_id'], 'text': 'Synthetic public-handle handoff'})
            async with asyncio.timeout(60):
                while True:
                    event = await handoff_events.get()
                    if event.get('type') == 'message.complete' and event.get('session_id') == root_chat['session_id']:
                        assert event.get('payload', {}).get('status') != 'error', event
                        break
        finally:
            native.listeners.discard(handoff_events)
        async with asyncio.timeout(60):
            while True:
                await asyncio.sleep(0.2)
                current_chat = await ops.invoke('bot.open', {'profile': 'new-researcher'})
                history = await ops.invoke('chat.history', {'session_id': current_chat['session_id']})
                if 'Public handle routing proof' in json.dumps(history):
                    break
        assert WorkspaceModel.handed, 'Model never called native message_agent with the public alias'
        await native.call('groups.create', {'room_id': 'public-handles-room', 'name': 'Public handles', 'members': [
            {'member_id': 'root', 'profile': 'default', 'handle': 'hermes', 'display_name': 'Aurora'},
            {'member_id': 'researcher', 'profile': 'new-researcher', 'handle': 'new-researcher', 'display_name': 'Maker'}]})
        sent = await workspace.invoke('room.send', {'room_id': 'public-handles-room', 'event_id': 'public-room-proof', 'text': '@aurora Synthetic room routing proof'})
        assert sent.get('driver_started') is True, sent
        try:
            async with asyncio.timeout(25):
                while True:
                    await asyncio.sleep(0.2)
                    room_log = await workspace.invoke('room.log', {'room_id': 'public-handles-room', 'since_seq': 0})
                    events = room_log.get('events', [])
                    if any(e.get('kind') == 'message.member' and e.get('actor', {}).get('id') == 'researcher' for e in events):
                        break
        except TimeoutError:
            print(json.dumps({'synthetic_room_log': room_log, 'synthetic_room_state': await ops.invoke('room.state', {'room_id': 'public-handles-room'}), 'room_model_received': WorkspaceModel.room_handed}))
            raise
        assert '@aurora Synthetic room routing proof' in json.dumps(room_log), room_log
        assert '@maker Room handoff proof' in json.dumps(room_log), room_log
        assert 'For this room only' in json.dumps(WorkspaceModel.requests)
        native_log = await native.call('groups.log', {'room_id': 'public-handles-room', 'since_seq': 0, 'limit': 100})
        assert '@new-researcher Room handoff proof' in json.dumps(native_log), native_log
        # A stale revision cannot overwrite a newer identity.
        try:
            await workspace.invoke('bots.update_handle', {'profile': 'default', 'handle': 'wrong', 'expected_revision': initialized['revision']})
        except InvalidOperation:
            pass
        else:
            raise AssertionError('Stale write accepted')
        persisted = WorkspaceStore(home / 'bot-web' / 'workspace.sqlite')
        assert persisted.read()['bots']['default']['id'] == root['id']
        persisted.db.close()
        print(json.dumps({'workspace': 'pass', 'revision': native.build['revision'], 'native_primary': 'pass', 'same_soul': 'pass', 'real_model_management_proposal': 'pass', 'real_main_pebble_reporting_and_applied_receipt': 'pass', 'caller_binding': 'pass', 'owner_approval': 'pass', 'live_public_handle_context': 'pass', 'new_agent_distinct_persona_and_real_model_turn': 'pass', 'single_provider_grant': 'pass', 'named_profile_management_context': 'pass', 'public_handle_native_dm': 'pass', 'public_handle_native_room_handoff': 'pass', 'metadata_merge': 'pass', 'stale_write_rejected': 'pass', 'native_live_profile_secret_settings_and_receipts': 'pass' if supports_live() else 'unsupported-on-legacy', 'model': 'synthetic-loopback-only'}))
    finally:
        store.db.close()
        await native.stop()


def main():
    with tempfile.TemporaryDirectory(prefix='workspace-native-') as directory:
        home = Path(directory) / 'home'
        home.mkdir()
        os.environ.clear()
        os.environ.update(PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin', HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory) / 'runtime'), PYTHONPYCACHEPREFIX=str(Path(directory) / 'pycache'), PYTHONUNBUFFERED='1', NO_PROXY='127.0.0.1,localhost', HERMES_NO_AUTO_INSTALL='1')
        os.environ.update(isolated_user_environment(directory))
        model = ThreadingHTTPServer(('127.0.0.1', 0), WorkspaceModel)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        shutil.copytree(ROOT / 'plugins/bot-web', home / 'plugins/bot-web', ignore=shutil.ignore_patterns('__pycache__'))
        (home / '.env').write_text('UNRELATED_TEST_KEY=synthetic-do-not-clone\n')
        (home / 'SOUL.md').write_text('SYNTHETIC_EXISTING_AURORA_PERSONALITY\n')
        (home / 'config.yaml').write_text('auth:\n  adopt_external_logins: false\nmodel:\n  default: fixture-model\n  provider: custom:fixture\nproviders:\n  fixture:\n    base_url: http://127.0.0.1:' + str(model.server_port) + '/v1\n    api_key: fixture-only\nagent:\n  max_turns: 12\n  coding_context: off\n  bot_mode_protocol: true\n  stream: false\ntoolsets:\n  - terminal\ntools:\n  tool_search:\n    enabled: \'off\'\nplugins:\n  enabled: [bot-web]\n  entries:\n    bot-web:\n      enabled: true\n')
        load_plugin(ROOT)
        try:
            asyncio.run(verify(home, model.server_port))
        finally:
            model.shutdown()

if __name__ == '__main__':
    main()
