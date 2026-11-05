"""Exercise the configured stdio reader with an actual multi-megabyte pipe."""
import asyncio
import json
import sys
import unittest
from unittest.mock import AsyncMock, patch
import test_security
from bot_web.native import NativeGateway


class NativeTransportFramesTests(unittest.IsolatedAsyncioTestCase):
    async def test_large_native_frame_survives_the_real_configured_reader(self):
        original = asyncio.create_subprocess_exec
        async def launch(*_args, **options):
            return await original(sys.executable, '-c',
                "import json,sys; print(json.dumps({'id':'large','result':{'text':'x'*(8*1024*1024)}}),flush=True); sys.stdin.buffer.read(1)",
                **options)
        gateway = NativeGateway()
        reply = asyncio.get_running_loop().create_future()
        gateway.pending['large'] = reply
        with patch('bot_web.native.check_native_adapter', return_value={'server_requests':False}), patch(
            'bot_web.native.asyncio.create_subprocess_exec', launch), patch.object(
            gateway, 'call', AsyncMock(side_effect=[{}, {'driver': True}, {'supported': True}])):
            await gateway.start()
            try:
                result = await asyncio.wait_for(reply, 10)
                self.assertEqual(len(result['text']), 8 * 1024 * 1024)
                self.assertTrue(gateway.healthy)
            finally:
                await gateway.stop()
