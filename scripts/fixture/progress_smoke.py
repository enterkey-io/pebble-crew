"""Real native progress discovery and delivery in a disposable, model-local Hermes home."""
import asyncio
import hashlib
from http.server import ThreadingHTTPServer
from importlib.util import find_spec
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from native_smoke import Model, isolated_user_environment, load_plugin, seed


async def exercise(root, home, port):
    seed(home, port)
    try: import hermes_yaml as yaml
    except ImportError: import yaml
    for path in (home/'config.yaml', home/'profiles/alpha/config.yaml'):
        value=yaml.safe_load(path.read_text())
        value['agent']['max_turns']=5
        value['platform_toolsets']={'cli':['terminal']}
        value['tools']={'tool_search':{'listing':'off'}}
        value['display']={'tool_progress':False}
        path.write_text(yaml.safe_dump(value))
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations
    from bot_web.workspace import WorkspaceStore, WorkspaceService, workspace_path
    from bot_web.payload import copy_payload
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
    from hermes_state import SessionDB
    copy_payload(root/'plugins/bot-web', home/'plugins/bot-web')
    assert dashboard_set_agent_plugin_enabled('bot-web', enabled=True).get('ok') is True
    gateway=NativeGateway(); await gateway.start()
    store=WorkspaceStore(workspace_path())
    try:
        service=WorkspaceService(BotOperations(gateway), store)
        await service.invoke('workspace.detect_primary', {})
        await service.invoke('workspace.initialize', {'profile':'default','handle':'hermes',
            'appearance':{'kind':'shape','shape':'pebble','color':'iris'},'photo':None,'expected_revision':store.read()['revision']})
        await gateway.call('bot_web.runtime.prepare', {'profile':'alpha'})
        sid=(await service.ops.invoke('bot.open', {'profile':'alpha'}))['session_id']
        protected={path:hashlib.sha256(path.read_bytes()).hexdigest() for path in home.rglob('*.md') if 'cache' not in path.parts}
        terminal_preferences={path:yaml.safe_load(path.read_text()).get('display') for path in (home/'config.yaml',home/'profiles/alpha/config.yaml')}
        queue=asyncio.Queue(maxsize=256); gateway.listeners.add(queue)
        assert Model.turns == 0, 'Native setup must remain model-free'
        await service.ops.invoke('chat.send', {'session_id':sid,'text':'nativeprogress: Please check the website project.'})
        seen=[]
        async with asyncio.timeout(90):
            while True:
                event=await queue.get();seen.append(event)
                if event.get('session_id')==sid and event.get('type')=='message.complete':break
        progress=[e for e in seen if e.get('type')=='status.update' and e.get('payload',{}).get('kind')=='progress']
        assert len(progress)==1 and progress[0]['session_id']==sid, progress
        assert progress[0]['payload']['text']=='Checking the website project'
        delta=next(i for i,e in enumerate(seen) if e.get('type')=='message.delta' and "I'll check the website project." in e.get('payload',{}).get('text',''))
        assert any(i>delta and e.get('type')=='tool.start' for i,e in enumerate(seen)), 'Client lifecycle feed must survive terminal tool progress off and an interim reply'
        assert any(e.get('type')=='tool.complete' for e in seen)
        assert Model.progress_guided and Model.progress_described and Model.progress_schema_received
        db=SessionDB(db_path=home/'profiles/alpha/state.db')
        try: messages=db.get_messages_as_conversation('canonical-alpha', include_ancestors=True)
        finally: db.close()
        assert any(m.get('role')=='assistant' and m.get('content')=='Native progress reply' for m in messages)
        assert not any(m.get('role') in {'user','assistant'} and m.get('content')=='Checking the website project' for m in messages)
        assert all(hashlib.sha256(path.read_bytes()).hexdigest()==digest for path,digest in protected.items())
        assert all(yaml.safe_load(path.read_text()).get('display')==display for path,display in terminal_preferences.items())
        print(json.dumps({'revision':gateway.build['revision'],'deferred_schema_discovered':True,
            'catalog_listing_disabled':True,'saved_terminal_selection':True,'one_correctly_scoped_public_caption':True,
            'no_extra_user_or_assistant_message':True,'personas_and_terminal_preferences_preserved':True,
            'lifecycle_after_interim_reply_with_terminal_progress_off':True,'model':'deterministic localhost only'}))
    finally:
        store.db.close();await gateway.stop()


def main():
    root=Path(__file__).resolve().parents[2]
    native_root=Path(next(iter(find_spec('tui_gateway').submodule_search_locations))).resolve().parent
    with tempfile.TemporaryDirectory(prefix='pebble-progress-') as directory:
        home=Path(directory)/'home';os.environ.clear()
        os.environ.update(HERMES_HOME=str(home),HERMES_RUNTIME_DIR=str(Path(directory)/'runtime'),
            PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin',HERMES_NO_AUTO_INSTALL='1',
            PYTHONUNBUFFERED='1',NO_PROXY='127.0.0.1,localhost',PYTHONPATH=str(native_root))
        os.environ.update(isolated_user_environment(directory))
        model=ThreadingHTTPServer(('127.0.0.1',0),Model)
        threading.Thread(target=model.serve_forever,daemon=True).start();load_plugin(root)
        try: asyncio.run(exercise(root,home,model.server_port))
        finally:model.shutdown();model.server_close()


if __name__=='__main__':main()
