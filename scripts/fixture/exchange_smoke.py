"""Real native peer execution with a loopback model, never an owner home."""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import sqlite3
import threading
import tempfile
import sys

from native_smoke import isolated_user_environment, load_plugin
ROOT=Path(__file__).resolve().parents[2]

class Model(BaseHTTPRequestHandler):
    requests=[]
    handed=False
    followup_stage=0
    followup_started=False
    def log_message(self,*args): pass
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"object":"list","data":[{"id":"fixture-model"}]}')
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if not self.path.endswith('/chat/completions'):
            self.send_response(200); self.end_headers(); self.wfile.write(b'{}'); return
        Model.requests.append(data)
        user=str(next((m.get('content') for m in reversed(data.get('messages',[])) if m.get('role')=='user'),''))
        name=args=None
        text='Owner direct reply'
        if 'START_FOLLOWUP_EXCHANGE' in user and not Model.followup_started:
            Model.followup_started=True; name='message_agent';args={'target':'chloe','message':'FOLLOWUP_NATIVE_REQUEST: Please ask Aurora a follow-up privately.'}
        elif 'FOLLOWUP_NATIVE_REQUEST' in user:
            import re
            exchange=re.search(r'"exchange_id": "([a-f0-9-]+)"',json.dumps(data).replace('\\"','"'))
            assert exchange, 'Missing exchange identity'
            if Model.followup_stage==0:
                name='tool_describe';args={'names':['pebble_exchange']};Model.followup_stage=1
            elif Model.followup_stage==1:
                assert 'pebble_exchange' in json.dumps(data) and 'parameters' in json.dumps(data)
                name='tool_call';args={'name':'pebble_exchange','arguments':{'exchange_id':exchange[1],'target':'aurora','message':'EXPLICIT_FOLLOWUP: Please verify the request.'}};Model.followup_stage=2
            else:
                results=[str(m.get('content')) for m in data.get('messages',[]) if m.get('role')=='tool']
                assert any('exchange_id' in result and 'queued' in result for result in results), results
                text='Chloe sent a follow-up.'
        elif 'START_PRIVATE_EXCHANGE' in user and not Model.handed:
            Model.handed=True; name='message_agent'; args={'target':'chloe','message':'PEER_INPUT_NONCE: Please answer privately.','notify_on_complete':True}
        elif 'PEER_INPUT_NONCE' in user:
            assert 'Verified private agent exchange' in json.dumps(data), 'Missing authenticated peer context'
            assert 'SYNTHETIC_CHLOE_SOUL' in json.dumps(data), 'Wrong native personality'
            text='PEER_REPLY_NONCE: Chloe answered privately.'
        elif 'PEER_REPLY_NONCE' in user:
            assert 'Verified private agent exchange' in json.dumps(data)
            text='PEER_RECEIPT_NONCE: Aurora received the reply.'
        reason='tool_calls' if name else 'stop'
        message={'role':'assistant','content':None if name else text}
        if name: message['tool_calls']=[{'id':'exchange-native-call','type':'function','function':{'name':name,'arguments':json.dumps(args)}}]
        response={'id':'exchange-fixture','object':'chat.completion','model':'fixture-model','choices':[{'index':0,'message':message,'finish_reason':reason}],'usage':{'prompt_tokens':100,'completion_tokens':20,'total_tokens':120}}
        self.send_response(200); self.send_header('Content-Type','text/event-stream' if data.get('stream') else 'application/json'); self.end_headers()
        if data.get('stream'):
            delta={'role':'assistant','content':text} if not name else {'role':'assistant','tool_calls':[{'index':0,**message['tool_calls'][0]}]}
            for part,finish in [(delta,None),({},reason)]:
                chunk={**response,'object':'chat.completion.chunk','choices':[{'index':0,'delta':part,'finish_reason':finish}]}
                self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
        else: self.wfile.write(json.dumps(response).encode())

async def verify(home):
    from bot_web.native import NativeGateway
    from bot_web.operations import BotOperations
    from bot_web.workspace import WorkspaceStore,WorkspaceService
    from bot_web.exchanges import Exchanges,supported
    native=NativeGateway(); await native.start()
    store=WorkspaceStore(home/'bot-web/workspace.sqlite'); ops=BotOperations(native); service=WorkspaceService(ops,store)
    try:
        await native.call('profiles.create',{'name':'chloe','no_alias':True,'no_skills':True,'mirror_credentials':False})
        grant=await native.call('bot_web.models',{'action':'describe'})
        await native.call('bot_web.models',{'action':'grant','profile':'chloe','expected':grant['fingerprint']})
        detection=await service.invoke('workspace.detect_primary',{})
        await service.invoke('workspace.initialize',{'profile':'default','handle':'aurora','appearance':{'kind':'shape','shape':'pebble','color':'iris'},'photo':None,'expected_revision':detection['revision']})
        await service.invoke('agent.enable',{'profile':'chloe','initialize_chat':True})
        from hermes_cli.profiles import get_profile_dir
        target=Path(get_profile_dir('chloe')); (target/'SOUL.md').write_text('SYNTHETIC_CHLOE_SOUL')
        # Runtime code must be present in the real selected profile, as provisioned by installation.
        shutil.copytree(ROOT/'plugins/bot-web',target/'plugins/bot-web',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
        try: import hermes_yaml as yaml
        except ImportError: import yaml
        config=yaml.safe_load((target/'config.yaml').read_text())
        if supported():
            install_memory_sink(target)
            config['memory']={'provider':'crew-memory-sink'}
        config['plugins']={'enabled':['bot-web'],'entries':{'bot-web':{'enabled':True}}}
        (target/'config.yaml').write_text(yaml.safe_dump(config))
        before={p:str((Path(get_profile_dir(p))/'SOUL.md').read_text()) for p in ['default','chloe']}
        a=await ops.invoke('bot.open',{'profile':'default'}); b=await ops.invoke('bot.open',{'profile':'chloe'})
        queue=asyncio.Queue();native.listeners.add(queue)
        await ops.invoke('chat.send',{'session_id':a['session_id'],'text':'START_PRIVATE_EXCHANGE'})
        async with asyncio.timeout(60):
            while True:
                e=await queue.get()
                if e.get('type')=='message.complete' and e.get('session_id')==a['session_id']: break
        ledger=Exchanges(store)
        real_call=native.call
        async def traced(method,params):
            try:
                result=await real_call(method,params)
                return result
            except Exception as error:
                print(json.dumps({'native_error':method,'error':str(error)}),flush=True)
                raise
        native.call=traced
        try:
            deliveries=ledger.db.execute('SELECT * FROM deliveries').fetchall()
            if not supported():
                assert not deliveries, 'Legacy build silently delivered a peer message'
                raw=await ops.invoke('chat.history',{'session_id':a['session_id']})
                db=sqlite3.connect(home/'state.db')
                results=db.execute("SELECT content FROM messages WHERE role='tool'").fetchall();db.close()
                assert 'UNSUPPORTED' in json.dumps(results),results
                target_db=sqlite3.connect(target/'state.db')
                assert 'PEER_INPUT_NONCE' not in json.dumps(target_db.execute('SELECT content FROM messages').fetchall())
                target_db.close()
                print(json.dumps({'native_exchange':'safely-unsupported','revision':native.build['revision'],'models':'synthetic-loopback-only'})); return
            assert len(deliveries)==1, {'count':len(deliveries),'requests':Model.requests[-1]}
            ident=deliveries[0]['exchange']
            await ledger.run_pending(native)
            await ledger.run_pending(native)
            data=ledger.read(ident)
            assert [m['text'].split(':')[0] for m in data['messages']]==['PEER_INPUT_NONCE','PEER_REPLY_NONCE','PEER_RECEIPT_NONCE'],data
            turns=len(Model.requests)
            await ledger.run_pending(native); await asyncio.sleep(.3)
            assert len(Model.requests)==turns, 'Exchange automatically ping-ponged'
            assert len({p['session'] for p in ledger.db.execute('SELECT session FROM participants')})==2
            for p in ['default','chloe']:
                assert (Path(get_profile_dir(p))/'SOUL.md').read_text()==before[p]
                db=sqlite3.connect(Path(get_profile_dir(p))/'state.db')
                try:
                    canonical=next(row['canonical_session']['id'] for row in await ops.profiles() if row['name']==p)
                    rows=db.execute('SELECT role,content FROM messages WHERE session_id=?',(canonical,)).fetchall()
                    text=json.dumps(rows)
                    assert 'PEER_REPLY_NONCE' not in text and 'PEER_RECEIPT_NONCE' not in text,text
                    if p=='chloe': assert 'PEER_INPUT_NONCE' not in text,text
                finally: db.close()
            for profile in ['default','chloe']:
                bot=store.read()['bots'][profile]
                assert ledger.references(bot['id'])['exchanges'][0]['id']==ident
            # Test the actual deferred tool through native middleware, not its handler directly.
            await ops.invoke('chat.send',{'session_id':a['session_id'],'text':'START_FOLLOWUP_EXCHANGE'})
            async with asyncio.timeout(60):
                while True:
                    event=await queue.get()
                    if event.get('type')=='message.complete' and event.get('session_id')==a['session_id']:break
            for _ in range(6):
                await ledger.run_pending(native)
                if not ledger.db.execute("SELECT 1 FROM deliveries WHERE state='queued'").fetchone():break
            assert Model.followup_stage==2, 'Deferred exchange tool was not invoked'
            assert ledger.db.execute("SELECT count(*) FROM messages WHERE text LIKE 'EXPLICIT_FOLLOWUP:%'").fetchone()[0]==1
            await asyncio.sleep(.5)
            bot_records=[];human_records=[]
            for profile in ['default','chloe']:
                path=Path(get_profile_dir(profile))
                for name,target_records in [('bot-events.jsonl',bot_records),('human-events.jsonl',human_records)]:
                    if (path/name).is_file():target_records.extend(json.loads(line) for line in (path/name).read_text().splitlines())
            assert any('PEER_INPUT_NONCE' in record['user'] and record['author']['id']=='bot:default' for record in bot_records),bot_records
            assert any('PEER_REPLY_NONCE' in record['user'] and record['author']['id']=='bot:chloe' for record in bot_records),bot_records
            assert any('START_PRIVATE_EXCHANGE' in record['user'] for record in human_records),human_records
            assert not any('PEER_INPUT_NONCE' in record['user'] or 'PEER_REPLY_NONCE' in record['user'] for record in human_records),human_records
            print(json.dumps({'native_exchange':'pass','revision':native.build['revision'],'separate_real_profile_sessions':True,'same_personas':True,'canonical_peer_content_absent':True,'paired_references':True,'bounded_receipt':True,'deferred_followup_tool':True,'native_bot_author_reaches_memory_provider':True,'models':'synthetic-loopback-only'}))
        finally:ledger.close()
    finally:
        store.db.close();await native.stop()

def install_memory_sink(home):
    directory=home/'plugins/crew-memory-sink';directory.mkdir(parents=True,exist_ok=True)
    (directory/'plugin.yaml').write_text('name: crew-memory-sink\nversion: 0.0.1\n')
    (directory/'__init__.py').write_text("""from pathlib import Path
import json
from agent.memory_provider import MemoryProvider
class Sink(MemoryProvider):
    @property
    def name(self):return 'crew-memory-sink'
    def is_available(self):return True
    def initialize(self,session_id,**kwargs):self.home=Path(kwargs['hermes_home'])
    def get_tool_schemas(self):return []
    def sync_turn(self,user_content,assistant_content,*,session_id='',messages=None,turn_author=None):
        filename='bot-events.jsonl' if turn_author and turn_author.get('is_bot') else 'human-events.jsonl'
        with (self.home/filename).open('a') as f:f.write(json.dumps({'user':user_content,'author':turn_author,'session':session_id})+'\\n')
def register(ctx):ctx.register_memory_provider(Sink())
""")

def main():
    with tempfile.TemporaryDirectory(prefix='pebble-exchange-') as directory:
        home=Path(directory)/'home';home.mkdir()
        os.environ.clear(); os.environ.update(PATH=f'{Path(sys.executable).parent}:/usr/bin:/bin',HERMES_HOME=str(home),HERMES_RUNTIME_DIR=str(Path(directory)/'runtime'),PYTHONPYCACHEPREFIX=str(Path(directory)/'pycache'),PYTHONUNBUFFERED='1',NO_PROXY='127.0.0.1,localhost',HERMES_NO_AUTO_INSTALL='1')
        os.environ.update(isolated_user_environment(directory))
        model=ThreadingHTTPServer(('127.0.0.1',0),Model);threading.Thread(target=model.serve_forever,daemon=True).start()
        shutil.copytree(ROOT/'plugins/bot-web',home/'plugins/bot-web',ignore=shutil.ignore_patterns('__pycache__'))
        (home/'SOUL.md').write_text('SYNTHETIC_AURORA_SOUL')
        (home/'config.yaml').write_text('auth:\n  adopt_external_logins: false\nmodel:\n  default: fixture-model\n  provider: custom:fixture\nproviders:\n  fixture:\n    base_url: http://127.0.0.1:'+str(model.server_port)+'/v1\n    api_key: synthetic-only\nagent:\n  max_turns: 8\n  coding_context: off\n  bot_mode_protocol: true\n  stream: false\ntoolsets: [terminal]\ntools:\n  tool_search:\n    enabled: off\nplugins:\n  enabled: [bot-web]\n  entries:\n    bot-web:\n      enabled: true\n')
        load_plugin(ROOT)
        from bot_web.exchanges import supported
        if supported():
            install_memory_sink(home)
            with (home/'config.yaml').open('a') as config:config.write('memory:\n  provider: crew-memory-sink\n')
        try:asyncio.run(verify(home))
        finally:model.shutdown()
if __name__=='__main__':main()
