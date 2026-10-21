import json
from pathlib import Path
import sqlite3
import sys
from types import ModuleType, SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
import test_security
from bot_web.exchanges import Exchanges, register_runtime
from bot_web.operations import InvalidOperation

class ExchangeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.bots={p:{'id':p,'profile':p,'handle':p,'name':p.title(),'enrolled':True,'available':True,'native_incarnation':p*64} for p in ['a','b']}
        self.store=SimpleNamespace(path=self.root/'workspace.sqlite',read=lambda:{'bots':self.bots})
        self.ledger=Exchanges(self.store);self.addCleanup(self.ledger.close)
        db=sqlite3.connect(self.root/'state.db');db.executescript("CREATE TABLE messages(session_id TEXT,role TEXT,content TEXT,tool_call_id TEXT,timestamp REAL); CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,parent_session_id TEXT,model_config TEXT,source TEXT,end_reason TEXT); INSERT INTO sessions VALUES('owner','Bot Chat',NULL,'{}','cli',NULL);");db.close()
        profiles=ModuleType('hermes_cli.profiles');profiles.get_profile_dir=lambda p:self.root
        self.enterContext(patch.dict(sys.modules,{'hermes_cli.profiles':profiles}))
        self.enterContext(patch('bot_web.exchanges.supported',return_value=True))
        self.enterContext(patch.object(self.ledger,'actor',side_effect=lambda i:self.bots[i]))
    def send(self,**changes):
        args={'profile':'a','session':'owner','task':'task','call':'call','turn':'turn','args':{'target':'b','message':'hello'}}
        return self.ledger.accept(**{**args,**changes})
    def test_shared_reference_dedup_and_reused_provider_id_on_another_turn(self):
        first=self.send(); self.assertEqual(self.send(),first)
        with self.assertRaises(InvalidOperation):self.send(args={'target':'b','message':'changed'})
        second=self.send(turn='different')
        self.assertNotEqual(first['exchange_id'],second['exchange_id'])
        self.assertEqual(self.ledger.references('a')['exchanges'][0]['id'],self.ledger.references('b')['exchanges'][0]['id'])
        self.assertEqual(len(self.ledger.read(first['exchange_id'])['messages']),1)
        self.assertEqual(set(first),{'state','exchange_id'})
    def test_only_verified_native_receipts_are_suppressed_not_reused_failed_call_ids(self):
        ident=self.send()['exchange_id']
        db=sqlite3.connect(self.root/'state.db')
        db.execute('INSERT INTO messages VALUES(?,?,?,?,?)',('owner','tool',json.dumps({'exchange_id':ident,'state':'queued'}),'call',123.25))
        db.execute('INSERT INTO messages VALUES(?,?,?,?,?)',('owner','tool',json.dumps({'error':'Recipient unavailable'}),'call',124.25))
        db.commit();db.close()
        ref=self.ledger.references('a')['exchanges'][0]
        self.assertEqual(ref['tool_receipts'],[{'call_id':'call','timestamp':123.25}])
        self.assertEqual(self.ledger.references('b')['exchanges'][0]['tool_receipts'],[])

    def test_completed_delivery_adds_one_reply_and_one_receipt_once(self):
        ident=self.send()['exchange_id']
        row=self.ledger.db.execute('SELECT * FROM deliveries').fetchone()
        self.ledger.db.execute("UPDATE deliveries SET pid=42,state='running' WHERE id=?",(row['id'],));self.ledger.db.commit()
        row=self.ledger.db.execute('SELECT * FROM deliveries').fetchone()
        self.assertFalse(self.ledger.complete(row,{'pid':43,'exit_code':0,'reply':'wrong'}))
        report={'pid':42,'exit_code':0,'reply':'reply'}
        self.assertTrue(self.ledger.complete(row,report)); self.assertTrue(self.ledger.complete(row,report))
        self.assertEqual(len(self.ledger.read(ident)['messages']),2)
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM deliveries').fetchone()[0],2)
        receipt=self.ledger.db.execute("SELECT * FROM deliveries WHERE kind='receipt'").fetchone()
        self.ledger.db.execute("UPDATE deliveries SET pid=43,state='running' WHERE id=?",(receipt['id'],));self.ledger.db.commit()
        receipt=self.ledger.db.execute('SELECT * FROM deliveries WHERE id=?',(receipt['id'],)).fetchone()
        self.ledger.complete(receipt,{'pid':43,'exit_code':0,'reply':'received'})
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM deliveries').fetchone()[0],2)
        self.assertEqual(len(self.ledger.read(ident)['messages']),3)
    def test_admission_reserves_each_reply_wakeup_inside_the_turn_budget(self):
        ident = self.send()['exchange_id']
        self.ledger.db.execute("UPDATE participants SET session='private-a' WHERE identity='a'"); self.ledger.db.commit()
        for index in range(3):
            self.send(session='private-a', call='followup-'+str(index), exchange=ident)
        with self.assertRaises(InvalidOperation):
            self.send(session='private-a', call='one-too-many', exchange=ident)
        for index, row in enumerate(self.ledger.db.execute("SELECT * FROM deliveries WHERE kind='request'").fetchall()):
            pid = index+40
            self.ledger.db.execute("UPDATE deliveries SET pid=?,state='running' WHERE id=?", (pid,row['id'])); self.ledger.db.commit()
            current = self.ledger.db.execute('SELECT * FROM deliveries WHERE id=?',(row['id'],)).fetchone()
            self.ledger.complete(current, {'pid':pid,'exit_code':0,'reply':'A real peer reply'})
        self.assertEqual(self.ledger.db.execute("SELECT count(*) FROM deliveries WHERE kind='receipt'").fetchone()[0],4)
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM deliveries').fetchone()[0],8)

    def test_reply_awareness_and_history_survive_ledger_reopen(self):
        ident = self.send()['exchange_id']
        row = self.ledger.db.execute('SELECT * FROM deliveries').fetchone()
        self.ledger.db.execute("UPDATE deliveries SET pid=42,state='running' WHERE id=?", (row['id'],)); self.ledger.db.commit()
        row = self.ledger.db.execute('SELECT * FROM deliveries').fetchone()
        self.ledger.complete(row, {'pid': 42, 'exit_code': 0, 'reply': 'Peer result. '*100})
        activity = self.ledger.activity('a', compact=True)[0]
        self.assertEqual(activity['exchange_id'], ident)
        self.assertEqual(activity['message_count'], 2)
        self.assertEqual(activity['reply_notification'], 'queued')
        self.assertEqual(activity['peer'], '@b')
        self.assertEqual(len(activity['latest_peer_message']), 160)
        self.assertTrue(activity['message_truncated'])
        receipt = self.ledger.db.execute("SELECT * FROM deliveries WHERE kind='receipt'").fetchone()
        self.ledger.db.execute("UPDATE deliveries SET pid=43,state='running' WHERE id=?", (receipt['id'],)); self.ledger.db.commit()
        receipt = self.ledger.db.execute('SELECT * FROM deliveries WHERE id=?', (receipt['id'],)).fetchone()
        self.ledger.complete(receipt, {'pid': 43, 'exit_code': 0, 'reply': 'I received the reply.'})
        reopened = Exchanges(self.store)
        try:
            for identity in ['a', 'b']:
                with patch.object(reopened, 'actor', side_effect=lambda i: self.bots[i]):
                    ref = reopened.references(identity)['exchanges'][0]
                    self.assertEqual((ref['id'], ref['count']), (ident, 3))
                    self.assertEqual(reopened.activity('a')[0]['reply_notification'], 'completed')
        finally:
            reopened.close()

    def test_cross_connection_commits_push_changes_and_reads_do_not(self):
        import asyncio
        async def verify():
            observer = Exchanges(self.store)
            changes = observer.changes()
            pending = None
            try:
                pending = asyncio.create_task(anext(changes))
                await asyncio.sleep(0)
                self.send()
                await asyncio.wait_for(pending, 2)
                pending = asyncio.create_task(anext(changes))
                await asyncio.sleep(0)
                self.ledger.read(self.ledger.references('a')['exchanges'][0]['id'])
                reader = Exchanges(self.store)
                try:
                    with patch.object(reader, 'actor', side_effect=lambda i: self.bots[i]):
                        reader.references('a')
                finally:
                    reader.close()
                await asyncio.sleep(0.55)
                self.assertFalse(pending.done(), 'A read must not create an update loop')
            finally:
                if pending and not pending.done():
                    pending.cancel()
                    try: await pending
                    except asyncio.CancelledError: pass
                await changes.aclose()
                observer.close()
        asyncio.run(verify())

    def test_retired_incarnation_and_compression_branch_boundaries(self):
        ident=self.send()['exchange_id'];self.ledger.db.execute("UPDATE participants SET session='owner' WHERE identity='a'");self.ledger.db.commit()
        db=sqlite3.connect(self.root/'state.db');db.executescript("UPDATE sessions SET end_reason='compression' WHERE id='owner'; INSERT INTO sessions VALUES('tip','continued','owner','{}','cli',NULL); INSERT INTO sessions VALUES('branch','branch','owner','{\"_branched_from\":\"owner\"}','cli',NULL);");db.close()
        self.assertEqual(self.ledger.scope('tip','a')['exchange'],ident)
        self.assertIsNone(self.ledger.scope('branch','a'))
        self.bots['a']['native_incarnation']='new'
        with self.assertRaises(InvalidOperation):self.ledger.read(ident)
    def test_failed_admission_is_never_retried_after_restart(self):
        import asyncio
        self.send()
        self.ledger.db.execute("UPDATE deliveries SET state='submitting'");self.ledger.db.commit()
        calls=[]
        async def call(method,params):calls.append(method);raise AssertionError('Must not resubmit')
        asyncio.run(self.ledger.run_pending(SimpleNamespace(call=call)))
        self.assertEqual(calls,[])
        self.assertEqual(self.ledger.db.execute('SELECT state FROM deliveries').fetchone()[0],'uncertain')
    def test_middleware_consumes_both_tools_even_when_store_opening_fails(self):
        middleware={}
        ctx=SimpleNamespace(register_middleware=lambda name,fn:middleware.update({name:fn}),register_tool=lambda **kwargs:None)
        register_runtime(ctx)
        called=[]
        with patch('bot_web.workspace.WorkspaceStore',side_effect=OSError('synthetic')):
            for name,args in [('message_agent',None),('message_agent',{}),('pebble_exchange',{'exchange_id':'x','target':'b','message':'hi'})]:
                result=middleware['tool_execution'](tool_name=name,args=args,session_id='owner',task_id='task',turn_id='turn',tool_call_id='id',next_call=lambda:called.append(True))
                self.assertIn('error',json.loads(result))
        self.assertEqual(called,[])
