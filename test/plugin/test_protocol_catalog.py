import ast
import base64
import io
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

import httpx
from test_security import Native, TOKEN, ORIGIN, HOST
from test_workspace import WorkspaceNative
from bot_web.operations import BotOperations
from bot_web.server import create_app, PROTOCOL_CATALOG, ROUTES
from bot_web.workspace import WorkspaceStore, WorkspaceService

ROOT = Path(__file__).resolve().parents[2]


class CatalogTests(unittest.TestCase):
    def test_catalog_exactly_covers_real_handlers_and_every_body_class(self):
        supported = set()
        for filename in ['operations.py', 'workspace.py', 'server.py', 'computer.py', 'attachments.py']:
            tree = ast.parse((ROOT / 'plugins/bot-web' / filename).read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Compare) and isinstance(node.left, ast.Name) and node.left.id == 'operation':
                    for item in node.comparators:
                        if isinstance(item, ast.Constant) and isinstance(item.value, str):
                            supported.add(item.value)
                        elif isinstance(item, (ast.Set, ast.List, ast.Tuple)):
                            supported.update(value.value for value in item.elts if isinstance(value, ast.Constant) and isinstance(value.value, str))
                if filename == 'workspace.py' and isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'METHODS' for target in node.targets):
                    supported.update(ast.literal_eval(node.value))
        self.assertEqual(PROTOCOL_CATALOG['schema'], 1)
        self.assertEqual(PROTOCOL_CATALOG['protocol'], 'hermes-bot-web.v1')
        self.assertEqual(set(PROTOCOL_CATALOG['operations']), supported)
        self.assertEqual(ROUTES['/v1/rpc']['maxBytes'], 65_536)
        self.assertEqual(ROUTES['/v1/avatar']['maxBytes'], 3_000_000)
        self.assertEqual(ROUTES['/v1/files/upload']['maxBytes'], 14 * 1024 * 1024 + 4096)
        rpc_paths = set()
        for node in ast.walk(ast.parse((ROOT / 'plugins/bot-web/server.py').read_text())):
            if isinstance(node, ast.AsyncFunctionDef) and node.name == 'rpc':
                rpc_paths.update(decorator.args[0].value for decorator in node.decorator_list)
        catalog_paths = set()
        for definition in PROTOCOL_CATALOG['operations'].values():
            self.assertIn(definition['preferred'], definition['accepted'])
            for name in definition['accepted']:
                route = PROTOCOL_CATALOG['routes'][name]
                self.assertEqual(route['methods'], ['POST'])
                catalog_paths.add(route['path'])
        self.assertEqual(rpc_paths, catalog_paths)


class RouteBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_wrong_class_and_cross_session_operations_never_reach_native(self):
        native = Native()
        app = create_app(TOKEN, {ORIGIN}, {HOST}, native)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=f'https://{HOST}') as client:
            headers = {'Origin': ORIGIN, 'Authorization': 'Bearer ' + TOKEN}
            response = await client.post('/v1/connect', headers=headers)
            headers['X-Bot-Connection'] = response.json()['connection']
            for path, operation, params in [
                ('/v1/avatar', 'chat.send', {}), ('/v1/rpc', 'files.upload', {}),
                ('/v1/rpc', 'files.read', {}), ('/v1/files/upload', 'bots.list', {}),
                ('/v1/files/read', 'bots.list', {}), ('/v1/avatar', 'profiles.delete', {}),
                ('/v1/rpc', 'profiles.delete', {}), ('/v1/rpc', 'constructor', {}),
                ('/v1/rpc', 'chat.send', {'session_id': 'not-opened', 'text': 'no'}),
            ]:
                response = await client.post(path, json={'operation': operation, 'params': params}, headers=headers)
                self.assertEqual(response.status_code, 400, (path, operation))
            for path, limit in [('/v1/rpc', 65_536), ('/v1/avatar', 3_000_000)]:
                response = await client.post(path, content=b' ' * limit, headers={**headers, 'Content-Type': 'application/json'})
                self.assertEqual(response.status_code, 400)
                response = await client.post(path, content=b' ' * (limit + 1), headers=headers)
                self.assertEqual(response.status_code, 413)
            response = await client.post('/v1/avatar', json={'operation': 'bots.profile.update', 'params': {}}, headers={**headers, 'Authorization': 'Bearer wrong'})
            self.assertEqual(response.status_code, 401)
            response = await client.post('/v1/avatar', json={'operation': 'bots.profile.update', 'params': {}}, headers={**headers, 'Origin': 'https://evil.test'})
            self.assertEqual(response.status_code, 403)
        self.assertEqual(native.calls, [])


class PhotoNative(WorkspaceNative):
    def __init__(self):
        super().__init__()
        self.assets = {}

    async def call(self, method, params):
        if method == 'profiles.set_asset':
            self.calls.append((method, params))
            self.assets[params['name']] = params['data']
            return {'ok': True}
        if method == 'profiles.get_asset':
            self.calls.append((method, params))
            data = self.assets.get(params['name'])
            return {'found': bool(data), 'data': data}
        return await super().call(method, params)


class ProfilePhotoRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from PIL import Image
        self.directory = tempfile.TemporaryDirectory()
        self.store = WorkspaceStore(Path(self.directory.name) / 'workspace.sqlite')
        self.native = PhotoNative()
        self.workspace = WorkspaceService(BotOperations(self.native), self.store)
        detection = await self.workspace.invoke('workspace.detect_primary', {})
        await self.workspace.invoke('workspace.initialize', {'profile': 'default', 'handle': 'aurora',
            'appearance': {'kind': 'shape', 'shape': 'seed', 'color': 'moss'}, 'photo': None,
            'expected_revision': detection['revision']})
        from bot_web.attachments import AttachmentStore
        def create_attachments(root):
            self.attachments = AttachmentStore(root)
            return self.attachments
        with patch('bot_web.attachments.AttachmentStore', side_effect=create_attachments):
            app = create_app(TOKEN, {ORIGIN}, {HOST}, self.native, workspace=self.workspace)
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=f'https://{HOST}')
        self.headers = {'Origin': ORIGIN, 'Authorization': 'Bearer ' + TOKEN}
        connection = (await self.http.post('/v1/connect', headers=self.headers)).json()['connection']
        self.headers['X-Bot-Connection'] = connection
        output = io.BytesIO()
        Image.frombytes('RGB', (512, 512), random.Random(123456).randbytes(512 * 512 * 3)).save(output, format='PNG')
        self.photo = 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode()
        self.assertGreater(len(self.photo), 65_536)
        self.assertLess(len(self.photo), 3_000_000)

    async def asyncTearDown(self):
        await self.http.aclose()
        self.attachments.db.close()
        self.store.db.close()
        self.directory.cleanup()

    async def params(self, profile, kind='photo', photo=None):
        state = await self.workspace.invoke('workspace.describe', {})
        bot = next(bot for bot in state['bots'] if bot['profile'] == profile)
        return {'profile': profile, 'id': bot['id'], 'name': bot['name'], 'handle': bot['handle'],
            'appearance': {**bot['appearance'], 'kind': kind}, 'role': bot['role'],
            'manager': bot['manager'], 'photo': photo, 'expected_revision': state['revision']}

    async def test_large_onboard_and_edit_reach_handler_and_preserve_photo_through_shape(self):
        for operation, profile in [('agent.onboard', 'amy'), ('bots.profile.update', 'default')]:
            params = await self.params(profile, photo=self.photo)
            response = await self.http.post('/v1/avatar', json={'operation': operation, 'params': params}, headers=self.headers)
            self.assertEqual(response.status_code, 200, response.text)
            saved = self.native.assets[profile]
            self.assertEqual(self.store.read()['bots'][profile]['appearance']['kind'], 'photo')
            for kind in ['shape', 'photo']:
                params = await self.params(profile, kind=kind)
                response = await self.http.post('/v1/rpc', json={'operation': 'bots.profile.update', 'params': params}, headers=self.headers)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(self.native.assets[profile], saved)
                self.assertEqual(self.store.read()['bots'][profile]['appearance']['kind'], kind)
        self.assertFalse(any(method == 'prompt.submit' for method, _ in self.native.calls))

    async def test_rpc_stays_bounded_and_malformed_photos_never_replace_assets(self):
        params = await self.params('default', photo=self.photo)
        response = await self.http.post('/v1/rpc', json={'operation': 'bots.profile.update', 'params': params}, headers=self.headers)
        self.assertEqual(response.status_code, 413)
        params['photo'] = 'data:image/png;base64,bm90LWFuLWltYWdl'
        response = await self.http.post('/v1/avatar', json={'operation': 'bots.profile.update', 'params': params}, headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'INVALID_PHOTO')
        self.assertEqual(self.native.assets, {})
