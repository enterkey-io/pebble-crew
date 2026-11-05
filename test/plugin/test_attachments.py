import base64
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from test_security import Native
from bot_web.operations import BotOperations, InvalidOperation
from bot_web.attachments import AttachmentStore
from bot_web.native import NativeError

class FilesNative(Native):
    def __init__(self):
        super().__init__()
        self.fail = False
        self.history = []
    async def call(self, method, params):
        if method == 'bot_web.attachments':
            self.calls.append((method, params))
            return {'attached': True, 'ref_text': '@file /private/' + str(params.get('id', '')) + '.txt'}
        if method == 'bot_web.conversation.history':
            return {'messages': self.history}
        if method == 'prompt.submit':
            self.calls.append((method, params))
            if self.fail:
                raise NativeError('unknown delivery')
            return {'submitted': True}
        return await super().call(method, params)

class AttachmentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.native = FilesNative()
        self.ops = BotOperations(self.native)
        await self.ops.invoke('bot.open', {'profile':'alpha'})
        self.store = AttachmentStore(Path(self.tmp.name)/'files')
    async def asyncTearDown(self):
        self.store.db.close()
        self.tmp.cleanup()
    async def upload(self, **changes):
        return await self.store.upload(self.ops, 'owner', {'session_id':'live-alpha','name':'notes.txt','data':base64.b64encode(b'private fixture').decode(),**changes})
    async def test_real_scope_staging_receipt_and_download_survive_reopen(self):
        row = await self.upload()
        self.assertEqual(self.native.calls[-1][0], 'bot_web.lifecycle')
        params = {'session_id':'live-alpha','text':'Read this','attachments':[row['id']],'request_id':'send-1'}
        self.assertEqual((await self.store.submit(self.ops,'owner',params))['state'],'accepted')
        self.assertEqual((await self.store.submit(self.ops,'owner',params))['state'],'accepted')
        self.assertEqual(sum(m=='prompt.submit' for m,_ in self.native.calls),1)
        self.store.db.close();self.store=AttachmentStore(Path(self.tmp.name)/'files')
        result,data=await self.store.invoke(self.ops,'owner','files.read',{'session_id':'live-alpha','id':row['id']})
        self.assertEqual(data,b'private fixture')
        self.assertEqual(result['name'],'notes.txt')
        for principal in ['other']:
            with self.assertRaises(InvalidOperation):
                await self.store.invoke(self.ops,principal,'files.read',{'session_id':'live-alpha','id':row['id']})
        self.native.incarnation='b'*64
        with self.assertRaises(InvalidOperation):
            await self.store.invoke(self.ops,'owner','files.read',{'session_id':'live-alpha','id':row['id']})
    async def test_bad_names_bytes_images_limits_and_symlinks_never_reach_native(self):
        for changes in [{'name':'../x'},{'name':'x\x00.txt'},{'data':'not base64'},{'name':'fake.png'},{'data':''}]:
            with self.assertRaises(InvalidOperation): await self.upload(**changes)
        with patch('bot_web.attachments.MAX_STORAGE',1):
            with self.assertRaises(InvalidOperation): await self.upload()
        row=await self.upload();path=self.store.path(row['id']);path.unlink();path.symlink_to(Path(self.tmp.name)/'secret')
        with self.assertRaises(InvalidOperation): self.store.read(row)
        self.assertFalse(any(m=='prompt.submit' for m,_ in self.native.calls))
    async def test_unknown_send_never_replays_and_requires_explicit_cleanup(self):
        row=await self.upload();params={'session_id':'live-alpha','text':'Read','attachments':[row['id']],'request_id':'uncertain-1'}
        self.native.fail=True
        with self.assertRaises(NativeError): await self.store.submit(self.ops,'owner',params)
        self.assertEqual((await self.store.submit(self.ops,'owner',params))['state'],'uncertain')
        self.assertEqual(sum(m=='prompt.submit' for m,_ in self.native.calls),1)
        with self.assertRaises(InvalidOperation): await self.store.submit(self.ops,'owner',{**params,'text':'changed'})
        self.assertEqual((await self.store.invoke(self.ops,'owner','files.reconcile',{'session_id':'live-alpha'}))['state'],'uncertain')
        self.assertEqual((await self.store.invoke(self.ops,'owner','files.discard',{'session_id':'live-alpha'}))['state'],'discarded')
        self.assertEqual(sum(m=='prompt.submit' for m,_ in self.native.calls),1)
    async def test_duplicate_ids_foreign_sessions_and_changed_blobs_rejected(self):
        row=await self.upload()
        for changes in [{'attachments':[row['id'],row['id']]},{'session_id':'another-session'}]:
            with self.assertRaises(InvalidOperation): await self.store.submit(self.ops,'owner',{'session_id':'live-alpha','text':'','attachments':[row['id']],'request_id':'new-send',**changes})
        self.store.path(row['id']).write_bytes(b'changed')
        with self.assertRaises(InvalidOperation): self.store.read(row)
        self.assertFalse(any(m=='prompt.submit' for m,_ in self.native.calls))

    async def test_lost_attachment_receipt_can_be_reconciled_beyond_the_recent_page(self):
        row = await self.upload()
        self.native.fail = True
        with self.assertRaises(NativeError):
            await self.store.submit(self.ops, 'owner', {'session_id':'live-alpha', 'text':'Read',
                'attachments':[row['id']], 'request_id':'lost-receipt'})
        original = self.native.call
        pages = []
        async def call(method, params):
            if method == 'bot_web.conversation.history':
                pages.append(params)
                return {'messages': [{'role':'user', 'text':row['id']}], 'history_page':{'older':None}} if params.get('before') == 'earlier' else {
                    'messages':[{'role':'assistant','text':'Recent unrelated work'}], 'history_page':{'older':'earlier'}}
            return await original(method, params)
        with patch.object(self.native, 'call', side_effect=call):
            result = await self.store.invoke(self.ops,'owner','files.reconcile',{'session_id':'live-alpha'})
        self.assertEqual(result, {'state':'accepted','ids':[row['id']]})
        self.assertEqual(len(pages), 2)
        self.assertEqual(sum(method == 'prompt.submit' for method, _ in self.native.calls), 1)
