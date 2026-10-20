"""Native two-way reactions with isolated homes and deterministic localhost inference."""
import asyncio
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading

from native_smoke import Model, load_plugin, seed


async def exercise(root, home, port):
    seed(home, port)
    soul = home / 'SOUL.md'
    soul.write_text('You are the synthetic reaction acceptance agent.\n')
    original_soul = soul.read_bytes()
    try:
        import hermes_yaml as yaml
    except ImportError:
        import yaml
    original_config = yaml.safe_load((home / 'config.yaml').read_text())
    from bot_web.native import NativeGateway, NativeError
    from bot_web.operations import BotOperations
    from bot_web.workspace import WorkspaceStore, WorkspaceService, workspace_path
    from bot_web.payload import copy_payload
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
    # Match a real plugin install: the launch profile's integration is installed
    # and enabled before the native process performs initial tool discovery.
    copy_payload(root / 'plugins/bot-web', home / 'plugins/bot-web')
    assert dashboard_set_agent_plugin_enabled('bot-web', enabled=True).get('ok') is True
    gateway = NativeGateway()
    await gateway.start()
    store = WorkspaceStore(workspace_path())
    try:
        ops = BotOperations(gateway)
        service = WorkspaceService(ops, store)
        detection = await service.invoke('workspace.detect_primary', {})
        await service.invoke('workspace.initialize', {'profile': detection['profile'], 'handle': 'aurora',
            'appearance': {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}, 'photo': None,
            'expected_revision': detection['revision']})
        # Existing installs can already have the plugin enabled while their saved
        # CLI tool selection predates a new capability. Reopening must reconcile it.
        configured = yaml.safe_load((home / 'config.yaml').read_text())
        configured['platform_toolsets'] = {'cli': ['terminal']}
        configured['tools'] = {'tool_search': {'listing': 'off'}}
        (home / 'config.yaml').write_text(yaml.safe_dump(configured))
        sid = (await ops.invoke('bot.open', {'profile': detection['profile']}))['session_id']
        saved = yaml.safe_load((home / 'config.yaml').read_text())
        assert saved['display']['message_reactions'] is True
        assert saved['platform_toolsets']['cli'] == ['terminal', 'workspace']
        assert not (yaml.safe_load((home / 'profiles/alpha/config.yaml').read_text()).get('display') or {}).get('message_reactions')
        for key in ('model', 'providers', 'toolsets', 'approvals'):
            assert saved[key] == original_config[key], key
        events = asyncio.Queue(maxsize=256)
        gateway.listeners.add(events)
        streamed = []

        async def turn(text):
            streamed.clear()
            await ops.invoke('chat.send', {'session_id': sid, 'text': text})
            async with asyncio.timeout(60):
                while True:
                    event = await events.get()
                    if event.get('session_id') == sid and event.get('type') in {'message.delta', 'message.interim', 'message.complete'}:
                        streamed.append(event.get('payload', {}).get('text', ''))
                    if event.get('session_id') == sid and event.get('type') == 'message.complete':
                        assert event.get('payload', {}).get('status') != 'error', event
                        break
            return (await ops.invoke('chat.history', {'session_id': sid}))['messages']

        messages = await turn('nativereaction')
        user = next(m for m in messages if m.get('role') == 'user' and m.get('text') == 'nativereaction')
        assert any(r.get('emoji') == '👍' and r.get('author') == 'agent' for r in user.get('display_metadata', {}).get('reactions', [])), {'tools': sorted(Model.tools_seen), 'results': Model.tool_results, 'messages': messages}
        assert Model.emitted_reaction, Model.tools_seen
        assert Model.reaction_schema_received or 'pebble_react' in Model.tools_seen
        assert Model.reaction_discovery_guided or 'pebble_react' in Model.tools_seen
        reply = next(m for m in reversed(messages) if m.get('role') == 'assistant' and m.get('text'))
        before = Model.turns
        receipt = await ops.invoke('chat.react', {'session_id': sid, 'row_id': reply['row_id'], 'emoji': '❤️'})
        assert receipt['reactions'][0]['author'] == 'user'
        assert Model.turns == before
        messages = await turn('nativefeedback')
        assert any(m.get('text') == 'Native feedback received' for m in messages), messages
        await ops.invoke('chat.react', {'session_id': sid, 'row_id': reply['row_id'], 'emoji': None})
        reopened = await ops.invoke('bot.open', {'profile': detection['profile']})
        restored = {m.get('row_id'): m for m in reopened['messages']}
        assert restored[user['row_id']]['display_metadata']['reactions'][0]['emoji'] == '👍'
        assert not restored[reply['row_id']].get('display_metadata', {}).get('reactions')
        Model.emitted_reaction = False
        Model.reaction_describe_requested = False
        before_rows = {m.get('row_id') for m in reopened['messages']}
        messages = await turn('nativereactiononly: thanks, no reply needed')
        reaction_only_user = next(m for m in messages if m.get('text') == 'nativereactiononly: thanks, no reply needed')
        assert any(r.get('emoji') == '👍' and r.get('author') == 'agent' for r in reaction_only_user.get('display_metadata', {}).get('reactions', []))
        assert not any(m.get('role') == 'assistant' and (m.get('text') or '').strip() for m in messages if m.get('row_id') not in before_rows), messages
        assert not any(text.strip() for text in streamed), streamed
        resumed = await ops.invoke('bot.open', {'profile': detection['profile']})
        assert not any(m.get('role') == 'assistant' and (m.get('text') or '').strip() for m in resumed['messages'] if m.get('row_id') not in before_rows), resumed
        try:
            await ops.invoke('chat.react', {'session_id': reopened['session_id'], 'row_id': 9007199254740991, 'emoji': '👍'})
        except NativeError:
            pass
        else:
            raise AssertionError('Native reaction accepted a nonexistent message')
        # The public handle differs from the room's frozen native alias. The
        # real driver must route it, expose the tool, and receive owner feedback.
        await ops.invoke('room.create', {'room_id': 'reaction-group', 'name': 'Reaction group', 'profiles': ['default', 'alpha']})
        Model.group_audit = []
        Model.emitted_reaction = False
        Model.reaction_describe_requested = False
        await service.invoke('room.send', {'room_id': 'reaction-group', 'event_id': 'group-first', 'text': '@aurora nativereaction: hello in this group'})
        async def group_log(predicate):
            try:
                async with asyncio.timeout(90):
                    while True:
                        log = await service.invoke('room.log', {'room_id': 'reaction-group', 'since_seq': 0})
                        state = await ops.invoke('room.state', {'room_id': 'reaction-group'})
                        if predicate(log) and not state.get('driver_status', {}).get('working'):
                            return log
                        last_user = max((e['seq'] for e in log['events'] if e['kind'] == 'message.user'), default=0)
                        if not state.get('driver_status', {}).get('working') and any(e['seq'] > last_user and e['kind'] in {'turn.settled', 'turn.failed'} for e in log['events']):
                            raise TimeoutError('Native group settled without the expected result')
                        await asyncio.sleep(.1)
            except TimeoutError:
                raise AssertionError({'events': [(e['kind'], str(e.get('payload'))[:400]) for e in log['events']],
                    'driver': state.get('driver_status'), 'reactions': log['reaction_updates'],
                    'tool_results': Model.tool_results, 'emitted': Model.emitted_reaction, 'audit': Model.group_audit}) from None
        log = await group_log(lambda log: any(e.get('kind') == 'message.member' for e in log['events']) and any(r['reactions'] for r in log['reaction_updates']))
        user_event = next(e for e in log['events'] if e.get('kind') == 'message.user')
        assert user_event['payload']['text'].startswith('@aurora '), user_event
        assert any(r['name'] == 'Aurora' or r['actor'] == store.read()['bots']['default']['id'] for r in user_event['payload']['reactions']), log
        member_event = next(e for e in log['events'] if e.get('kind') == 'message.member')
        before = Model.turns
        user_receipt = await service.invoke('room.react', {'room_id': 'reaction-group', 'event_id': member_event['event_id'], 'emoji': '❤️'})
        assert user_receipt['reactions'][0]['author'] == 'user' and Model.turns == before
        await service.invoke('room.send', {'room_id': 'reaction-group', 'event_id': 'group-feedback', 'text': '@aurora nativegroupfeedback: confirm my reaction arrived'})
        log = await group_log(lambda log: any('Native group feedback received' in e.get('payload', {}).get('text', '') for e in log['events']))
        assert any(r['event_id'] == member_event['event_id'] and r['reactions'][0]['emoji'] == '❤️' for r in log['reaction_updates'])
        Model.emitted_reaction = False
        Model.reaction_describe_requested = False
        await service.invoke('room.send', {'room_id': 'reaction-group', 'event_id': 'group-reaction-only', 'text': '@aurora nativereactiononly: thanks, no reply needed'})
        log = await group_log(lambda log: any(e['kind'] == 'message.user' and 'nativereactiononly' in e.get('payload', {}).get('text', '') and e['payload'].get('reactions') for e in log['events']))
        user_seq = max(e['seq'] for e in log['events'] if e['kind'] == 'message.user')
        assert not any(e['kind'] == 'message.member' and (e.get('payload', {}).get('text') or '').strip() for e in log['events'] if e['seq'] > user_seq), log
        assert soul.read_bytes() == original_soul
        await gateway.stop()
        from bot_web.setup import sync_runtime
        before = Model.turns
        sync_runtime(native_idle=True)
        assert Model.turns == before
        assert soul.read_bytes() == original_soul
        print(json.dumps({'supported_revision': gateway.build['revision'], 'native_agent_reaction': True,
            'native_user_feedback_received': True, 'reactions_do_not_start_model_turns': True,
            'persistent_after_resume': True, 'only_opened_profile_enabled': True, 'persona_preserved': True,
            'reaction_only_without_live_or_reloaded_prose': True, 'native_group_mention_routing': True,
            'native_group_agent_reaction': True, 'native_group_owner_feedback': True}))
    finally:
        store.db.close()
        await gateway.stop()


def main():
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='pebble-native-reactions-') as directory:
        home = Path(directory) / 'home'
        home.mkdir()
        os.environ.clear()
        os.environ.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(Path(directory) / 'runtime'),
            PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin', HERMES_NO_AUTO_INSTALL='1',
            PYTHONUNBUFFERED='1', NO_PROXY='127.0.0.1,localhost')
        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        load_plugin(root)
        try:
            asyncio.run(exercise(root, home, model.server_port))
        finally:
            model.shutdown()


if __name__ == '__main__':
    main()
