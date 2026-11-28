import unittest
from unittest.mock import AsyncMock
from test_security import Native
from bot_web.commands import invoke
from bot_web.operations import BotOperations, InvalidOperation

class CommandBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.ops = BotOperations(Native())
        self.ops.sessions['chat-alpha'] = 'alpha'
        self.ops.session_incarnations['chat-alpha'] = 'a'*64
        self.ops.gateway.call = AsyncMock(return_value={'items': [{'text': 'model', 'display': '/model', 'meta': 'Switch model'}, {'text': 'reset', 'display': '/reset', 'meta': 'Erase'}], 'replace_from': 1})
        self.ops.bot = AsyncMock()
        self.ops.stamp = AsyncMock(return_value='a'*64)

    async def test_catalog_comes_from_native_session_and_leaves_out_blocked_commands(self):
        result = await invoke(self.ops, 'chat.commands', {'session_id': 'chat-alpha', 'text': '/'})
        self.assertEqual([item['text'] for item in result['items']], ['model'])
        self.ops.gateway.call.assert_any_await('complete.slash', {'session_id': 'chat-alpha', 'text': '/'})
        self.ops.gateway.call.assert_any_await('complete.slash', {'session_id': 'chat-alpha', 'text': '/model'})
        self.assertEqual(self.ops.gateway.call.await_count, 7)
        self.ops.gateway.call.return_value = {'items': [{'text': 'reload-mcp', 'display': '/reload-mcp'}]}
        result = await invoke(self.ops, 'chat.commands', {'session_id': 'chat-alpha', 'text': '/rel'})
        self.assertEqual([item['text'] for item in result['items']], ['reload-mcp'])

    async def test_other_native_commands_run_through_the_command_worker(self):
        self.ops.gateway.call.return_value = {'output': 'Reloaded 3 MCP servers'}
        result = await invoke(self.ops, 'chat.command', {'session_id': 'chat-alpha', 'text': '/reload-mcp'})
        self.assertEqual(result, {'output': 'Reloaded 3 MCP servers'})
        self.ops.gateway.call.assert_awaited_once_with('slash.exec', {'session_id': 'chat-alpha', 'command': 'reload-mcp'})
        self.ops.gateway.call.return_value = {'type': 'prompt', 'output': ''}
        with self.assertRaises(InvalidOperation):
            await invoke(self.ops, 'chat.command', {'session_id': 'chat-alpha', 'text': '/goal ship it'})

    async def test_model_switch_goes_to_native_command_worker_never_a_model_prompt(self):
        self.ops.gateway.call.return_value = {'output': 'Model changed'}
        result = await invoke(self.ops, 'chat.command', {'session_id': 'chat-alpha', 'text': '/model synthetic-model'})
        self.assertEqual(result, {'output': 'Model changed'})
        self.ops.gateway.call.assert_awaited_once_with('slash.exec', {'session_id': 'chat-alpha', 'command': 'model synthetic-model'})

    async def test_foreign_retired_and_unsupported_commands_do_not_execute(self):
        for sid, text in [('foreign', '/model test'), ('chat-alpha', '/reset'), ('chat-alpha', '/new'),
                          ('chat-alpha', '/title Other'), ('chat-alpha', '/restart'), ('chat-alpha', '/model test\n/do')]:
            with self.assertRaises(InvalidOperation):
                await invoke(self.ops, 'chat.command', {'session_id': sid, 'text': text})
        self.ops.stamp.return_value = 'b'*64
        with self.assertRaises(InvalidOperation):
            await invoke(self.ops, 'chat.command', {'session_id': 'chat-alpha', 'text': '/model test'})
        self.ops.gateway.call.assert_not_awaited()

    async def test_native_context_suffix_survives_catalog_filtering(self):
        self.ops.gateway.call.return_value = {'model':'claude-opus[1m]', 'provider':'native', 'providers':[{'slug':'native', 'name':'Native', 'authenticated':True, 'models':['claude-opus[1m]','normal-model','bad[other]','model --flag','-flag']}]}
        result = await invoke(self.ops, 'chat.model.options', {'session_id':'chat-alpha'})
        self.assertEqual(result['providers'][0]['models'], ['claude-opus[1m]','normal-model'])

    async def test_context_suffix_is_preserved_when_selecting_and_other_syntax_is_refused(self):
        self.ops.gateway.call.return_value = {'value':'claude-opus[1m]'}
        await invoke(self.ops, 'chat.model.select', {'session_id':'chat-alpha', 'provider':'native', 'model':'claude-opus[1m]', 'confirm':False})
        self.assertEqual(self.ops.gateway.call.await_args.args[1]['value'], 'claude-opus[1m] --provider native --session')
        for model in ['model[2m]','model[1m]--flag','model;echo','-flag','x'*251]:
            with self.assertRaises(InvalidOperation):
                await invoke(self.ops, 'chat.model.select', {'session_id':'chat-alpha', 'provider':'native', 'model':model, 'confirm':False})
