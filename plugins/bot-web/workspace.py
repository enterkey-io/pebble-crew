"""Owner-Hermes workspace metadata and typed native mutations.

SQLite contains identity/roles/receipts, never transcripts or provider secrets.
"""
import asyncio
import base64
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

from .operations import InvalidOperation, identifier, fields
from .native import NativeError

SHAPES = {'pebble', 'beacon', 'petal', 'kite', 'arch', 'cairn', 'seed', 'dune', 'flint', 'drift'}
COLORS = {'iris', 'citron', 'clay', 'lagoon', 'rose', 'sky', 'white', 'umber', 'moss', 'ocean', 'heather', 'sienna'}
ACTIONS = {'agent.enable', 'agent.create', 'agent.update', 'agent.attach', 'agent.hide', 'agent.delete'}
ROLE_TEXT_LIMITS = {'title': 1000, 'description': 1000, 'responsibilities': 12000, 'boundaries': 1000, 'expectedOutputs': 1000}


def workspace_path():
    from hermes_constants import get_hermes_home
    from tools.bot_mode_probe import _hermes_root
    return _hermes_root(Path(get_hermes_home())) / 'bot-web' / 'workspace.sqlite'


class WorkspaceStore:
    def __init__(self, path):
        path = Path(path)
        self.path = path.resolve()
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=5)
        os.chmod(path, 0o600)
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, spec TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL, result TEXT, created INTEGER NOT NULL, UNIQUE(actor,fingerprint));
            CREATE TABLE IF NOT EXISTS voice_credential(id INTEGER PRIMARY KEY CHECK(id=1), profile TEXT NOT NULL, fingerprint TEXT NOT NULL);
        ''')
        from .presentation import init_store
        init_store(self.db)
        self.db.execute('INSERT OR IGNORE INTO workspace VALUES(1,0,?)', (json.dumps({'schema': 1, 'id': str(uuid.uuid4()), 'bots': {}, 'teams': [], 'orchestrator': None, 'initialized': False, 'aliases': {}}),))
        self.db.commit()
        from .reporting import initialize
        initialize(self, path)

    def read(self):
        revision, data = self.db.execute('SELECT revision,data FROM workspace WHERE id=1').fetchone()
        return {**json.loads(data), 'revision': revision}

    def save(self, value, expected):
        value = deepcopy(value)
        value.pop('revision', None)
        with self.db:
            changed = self.db.execute('UPDATE workspace SET revision=revision+1,data=? WHERE id=1 AND revision=?', (json.dumps(value), expected)).rowcount
            if changed != 1:
                raise InvalidOperation('Workspace changed; refresh before saving', 'STALE_REVISION')
        return self.read()

    def request(self, actor, action, spec):
        if action not in ACTIONS:
            raise InvalidOperation('Management action unavailable')
        raw = json.dumps(spec, sort_keys=True, separators=(',', ':'))
        if len(raw) > 24000:
            raise InvalidOperation('Request too large')
        fingerprint = hashlib.sha256((action + raw).encode()).hexdigest()
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO requests VALUES(?,?,?,?,?,?,NULL,?)', (str(uuid.uuid4()), actor, action, raw, fingerprint, 'pending', int(time.time())))
        return self.db.execute('SELECT id,state FROM requests WHERE actor=? AND fingerprint=?', (actor, fingerprint)).fetchone()

    def requests(self):
        return [{'id': row[0], 'actor': row[1], 'action': row[2], 'spec': json.loads(row[3]), 'fingerprint': row[4], 'state': row[5], 'result': json.loads(row[6]) if row[6] else None}
                for row in self.db.execute('SELECT id,actor,action,spec,fingerprint,state,result FROM requests ORDER BY created DESC LIMIT 100')]


def bounded(value, length=1000, blank=True):
    if not isinstance(value, str) or len(value) > length or (not blank and not value.strip()):
        raise InvalidOperation('Invalid text')
    return value.strip()


def appearance(value):
    fields(value, ['kind', 'shape', 'color'])
    if value['kind'] not in {'shape', 'photo'} or value['shape'] not in SHAPES or value['color'] not in COLORS:
        raise InvalidOperation('Unsupported appearance')
    return dict(value)


def normalize_photo(data):
    if not isinstance(data, str) or len(data) > 2_800_000 or not re.fullmatch(r'data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+', data):
        raise InvalidOperation('Choose a PNG, JPEG or WebP photo')
    from PIL import Image, ImageOps
    import warnings
    try:
        blob = base64.b64decode(data.split(',', 1)[1], validate=True)
        if len(blob) > 2_000_000:
            raise ValueError()
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(blob)) as source:
                if source.format not in {'PNG', 'JPEG', 'WEBP'} or source.width * source.height > 16_000_000 or max(source.size) > 8192 or getattr(source, 'n_frames', 1) != 1:
                    raise ValueError()
                image = ImageOps.fit(ImageOps.exif_transpose(source).convert('RGB'), (512, 512))
                # Fresh raster drops EXIF/GPS, filename and embedded metadata.
                clean = Image.new('RGB', image.size)
                clean.paste(image)
                output = io.BytesIO()
                clean.save(output, format='PNG')
        return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode()
    except Exception as error:
        raise InvalidOperation('Photo could not be safely decoded', 'INVALID_PHOTO') from error


class WorkspaceService:
    METHODS = {'reporting.describe', 'reporting.policy', 'bots.profile.update', 'agent.onboard', 'agent.welcome', 'organization.get', 'organization.save', 'organization.chat', 'crews.save', 'workspace.snapshot', 'presentation.read', 'presentation.order', 'agent.pin', 'agent.hide', 'agent.delete', 'agent.propose', 'room.send', 'room.log', 'agent.enable', 'workspace.describe', 'workspace.detect_primary', 'workspace.initialize', 'workspace.welcome', 'workspace.set_orchestrator',
        'bots.update_handle', 'bots.appearance.get', 'bots.appearance.update', 'roles.update', 'teams.save',
        'models.describe', 'agent.model', 'agent.create', 'agent.update', 'agent.attach', 'requests.reconcile', 'requests.list', 'requests.approve', 'requests.deny',
        'connections.add', 'connections.permissions', 'connections.set_key', 'connections.list', 'connections.test', 'services.catalog', 'agent.capabilities'}

    def __init__(self, ops, store, primary=None):
        self.ops, self.store, self.primary = ops, store, primary
        self.lock = asyncio.Lock()

    def handles(self, operation):
        return operation in self.METHODS

    async def sync(self, include_model=True):
        state = self.store.read()
        before = json.dumps(state, sort_keys=True)
        profiles = await self.ops.profiles()
        from .presentation import identities, bind
        stamps = await identities(self, state, profiles)
        changed = False
        if include_model:
            try:
                model = await self.ops.gateway.call('bot_web.models', {'action': 'describe'})
            except NativeError:
                model = None
            if state.get('model_grant') != model:
                state['model_grant'] = model
                changed = True
        for row in profiles:
            name = row['name']
            if name not in state['bots']:
                meta = row.get('ui_meta', {}).get('hermes-bots') or {}
                handle = 'hermes' if name == 'default' else name
                if handle in state['aliases']:
                    handle = handle[:23]+'-'+uuid.uuid4().hex[:6]
                marker = row.get('ui_meta', {}).get('pebble-crew') or {}
                restored_id = marker.get('id') if marker.get('incarnation') == stamps.get(name) and stamps.get(name) else None
                if restored_id and (not isinstance(restored_id, str) or not re.fullmatch('[0-9a-f-]{36}', restored_id) or any(b['id'] == restored_id for b in state['bots'].values())):
                    restored_id = None
                state['bots'][name] = {'id': restored_id or str(uuid.uuid4()), 'profile': name, 'handle': handle,
                    'role': {'title': '', 'description': '', 'responsibilities': '', 'boundaries': '', 'expectedOutputs': ''},
                    'enrolled': isinstance(row.get('ui_meta', {}).get('hermes-bots'), dict), 'manager': None, 'manager_id': None, 'team': None, 'appearance': {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}}
                # Preserve native avatar data. Workspace shape contract is deliberately versioned.
                if isinstance(meta.get('workspaceAppearance'), dict):
                    try:
                        state['bots'][name]['appearance'] = appearance(meta['workspaceAppearance'])
                    except InvalidOperation:
                        pass
                changed = True
            meta = row.get('ui_meta', {}).get('hermes-bots') or {}
            if not isinstance(meta.get('workspaceAppearance'), dict) and state['bots'][name]['appearance'].get('kind') == 'photo':
                state['bots'][name]['appearance'] = {'kind': 'shape', 'shape': 'pebble', 'color': 'iris'}
                changed = True
            if 'sectionId' in meta:
                section_id, section_name = meta.get('sectionId'), meta.get('sectionName')
                if section_id is None:
                    state['bots'][name]['team'] = None
                elif isinstance(section_id, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', section_id) and isinstance(section_name, str) and 0 < len(section_name.strip()) <= 80:
                    team = next((t for t in state['teams'] if t['id'] == section_id), None)
                    if team is None:
                        state['teams'].append({'id': section_id, 'name': section_name.strip()})
                    else:
                        team['name'] = section_name.strip()
                    state['bots'][name]['team'] = section_id
            native_role = meta.get('workspaceRole')
            if isinstance(native_role, dict) and set(native_role) == set(ROLE_TEXT_LIMITS) and all(isinstance(v, str) and len(v) <= ROLE_TEXT_LIMITS[k] for k, v in native_role.items()):
                state['bots'][name]['role'] = deepcopy(native_role)
            state['bots'][name]['name'] = self.ops.summary(row)['name']
            await bind(self, row, state['bots'][name], stamps.get(name))
        if changed or json.dumps(state, sort_keys=True) != before:
            state = self.store.save(state, state['revision'])
        result = deepcopy(state)
        result['bots'] = [{**state['bots'][r['name']], **self.ops.summary(r)} for r in profiles]
        return result, profiles

    async def mirror(self, profile, changes, description=None):
        row = next((r for r in await self.ops.profiles() if r['name'] == profile), None)
        if row is None:
            raise InvalidOperation('Profile unavailable')
        meta = deepcopy(row.get('ui_meta', {}).get('hermes-bots') or {})
        meta.update(changes)
        params = {'name': profile, 'ui_meta': {'hermes-bots': meta}, 'ui_meta_expected_revisions': {'hermes-bots': row.get('ui_meta_revisions', {}).get('hermes-bots', 0)}}
        if description is not None:
            params['description'] = description
        result = await self.ops.gateway.call('profiles.configure', params)
        if result.get('applied', {}).get('ui_meta') is not True or (description is not None and result.get('applied', {}).get('description') is not True):
            raise InvalidOperation('Native metadata changed; refresh to reconcile')

    def graph(self, state):
        from .reporting import validate
        validate(state, self.store.read())

    @staticmethod
    def handle(state, profiles, profile, value):
        handle = bounded(value, 32, False).lower().removeprefix('@')
        if not re.fullmatch(r'[a-z][a-z0-9_-]{1,31}', handle) or handle in {'all', 'everyone', 'system', 'owner', 'admin'}:
            raise InvalidOperation('Use a unique handle of 2–32 letters, digits, underscores or dashes')
        # Reserve every native profile name/default alias and all retired public aliases.
        for row in profiles:
            native = 'hermes' if row['name'] == 'default' else row['name'].lower()
            if row['name'] != profile and handle in {native, row['name'].lower()}:
                raise InvalidOperation('Handle belongs to another native identity', 'HANDLE_TAKEN')
        for name, bot in state['bots'].items():
            if name != profile and bot['handle'] == handle:
                raise InvalidOperation('Handle is already in use', 'HANDLE_TAKEN')
        if handle in state['aliases'] and state['aliases'][handle] != profile:
            raise InvalidOperation('Handle is reserved by an existing identity', 'HANDLE_TAKEN')
        old = state['bots'][profile]['handle']
        state['aliases'][old] = profile
        state['aliases'][handle] = profile
        state['bots'][profile]['handle'] = handle
        return handle

    async def invoke(self, operation, params):
        async with self.lock:
            return await self._invoke(operation, params)

    async def _invoke(self, operation, params):
        from . import presentation
        if operation == 'workspace.snapshot':
            fields(params, [])
            return await presentation.snapshot(self)
        self._snapshot = None
        snapshot, profiles = await self.sync(include_model=operation in {'workspace.describe', 'workspace.detect_primary', 'models.describe', 'agent.model', 'agent.create'})
        state = self.store.read()
        if operation.startswith('reporting.'):
            from .reporting import receipts
            if operation == 'reporting.describe':
                fields(params, [])
                return {'workspace': snapshot, 'changes': receipts(self.store)}
            fields(params, ['enabled', 'expected_revision', 'policy_revision'])
            if type(params['enabled']) is not bool or type(params['expected_revision']) is not int or type(params['policy_revision']) is not int or params['expected_revision'] != state['revision'] or params['policy_revision'] != state['reporting']['policy_revision']:
                raise InvalidOperation('Organization changed; refresh before saving', 'STALE_REVISION')
            state['reporting'].update(management_enabled=params['enabled'], policy_revision=state['reporting']['policy_revision'] + 1)
            self.store.save(state, state['revision'])
            return {'state': 'completed'}
        if operation in {'bots.profile.update', 'agent.onboard', 'agent.welcome'}:
            from .identity import invoke
            return await invoke(self, operation, params, state, profiles)
        if operation.startswith('organization.'):
            from .organization import invoke
            return await invoke(self, operation, params, state)
        if operation == 'crews.save':
            from .crews import save
            return await save(self, params)
        if operation == 'agent.propose' and params.get('action') == 'agent.create':
            fields(params, ['action', 'spec'])
            spec = params['spec']
            fields(spec, ['name', 'display_name', 'soul', 'role', 'model_source', 'model_fingerprint', 'skills', 'toolsets', 'manager', 'team', 'expected_revision'])
            if spec['expected_revision'] != state['revision']:
                raise InvalidOperation('Refresh before reviewing creation', 'STALE_REVISION')
            bounded(spec['name'], 40, False)
            bounded(spec['display_name'], 80, False)
            bounded(spec['soul'], 12000, False)
            request_id, status = self.store.request('owner', 'agent.create', spec)
            return {'request_id': request_id, 'state': status}
        if operation in {'presentation.read', 'presentation.order', 'agent.pin', 'agent.hide', 'agent.delete', 'agent.propose'}:
            return await presentation.invoke(self, operation, params, state, profiles)
        if operation in {'room.send', 'room.log'}:
            from .room_identity import translate_send, translate_log
            fields(params, ['room_id', 'event_id', 'text'] if operation == 'room.send' else ['room_id', 'since_seq'])
            room = await self.ops.gateway.call('groups.state', {'room_id': identifier(params['room_id'])})
            members = room.get('room', {}).get('members', [])
            if operation == 'room.send':
                return await self.ops.invoke(operation, {**params, 'text': translate_send(state, members, bounded(params['text'], 16000, False))})
            return translate_log(state, members, await self.ops.invoke(operation, params))
        if operation == 'workspace.describe':
            fields(params, [])
            return snapshot
        if operation == 'workspace.detect_primary':
            fields(params, [])
            chosen = state['orchestrator'] or self.primary
            evidence = 'persisted-workspace-binding' if state['orchestrator'] else 'verified-operator-binding'
            if not chosen:
                defaults = [r['name'] for r in profiles if r.get('is_default') is True]
                chosen = defaults[0] if len(defaults) == 1 else None
                evidence = 'native-default-root'
            row = next((r for r in profiles if r['name'] == chosen), None)
            if chosen not in state['bots'] or row is None:
                return {'outcome': 'needs_operator_binding', 'complete': False}
            return {'outcome': 'detected', 'complete': True, 'profile': chosen, 'evidence': evidence, 'revision': state['revision'], 'bot': {**state['bots'][chosen], **self.ops.summary(row)}}
        if operation == 'requests.reconcile':
            fields(params, ['id'])
            request = next((r for r in self.store.requests() if r['id'] == params['id']), None)
            if not request or request['action'] != 'agent.delete' or request['state'] not in {'executing', 'partial', 'uncertain'}:
                raise InvalidOperation('No uncertain deletion to inspect')
            target = state['bots'].get(request['spec']['profile'])
            # Observation only: never replay the destructive native call. A replacement
            # profile is a different identity and is never touched by this receipt.
            same = target and target['id'] == request['spec']['id'] and target.get('available')
            return {'state': request['state'], 'target_present': bool(same),
                'message': 'Original profile is still present; inspect native lifecycle status in Hermes.' if same else 'Original profile is absent. Native identity settlement may still need attention in Hermes. Deletion has not been replayed.'}
        if operation == 'requests.list':
            fields(params, [])
            return {'requests': self.store.requests()}
        if operation in {'requests.approve', 'requests.deny'}:
            request = next((r for r in self.store.requests() if r['id'] == params.get('id')), None)
            fields(params, ['id', 'fingerprint', *(['confirmation'] if request and request['action'] == 'agent.delete' and operation == 'requests.approve' else [])])
            if not request or request['state'] != 'pending' or request['fingerprint'] != params['fingerprint']:
                raise InvalidOperation('Request changed or is no longer pending')
            if request['action'] == 'agent.delete' and operation.endswith('approve') and params.get('confirmation') != request['spec']['profile']:
                raise InvalidOperation('Type the exact profile name to confirm deletion')
            status = 'denied' if operation.endswith('deny') else 'executing'
            with self.store.db:
                changed = self.store.db.execute('UPDATE requests SET state=? WHERE id=? AND state=?', (status, request['id'], 'pending')).rowcount
                if changed != 1:
                    raise InvalidOperation('Request already handled')
            if status == 'denied':
                return {'state': status}
            # Mark before dispatch: a crash cannot cause a duplicate automatic native mutation.
            try:
                if request['action'] == 'agent.delete':
                    self._approved_delete = request['spec']['id']
                result = await self._invoke(request['action'], request['spec'])
                status = result.get('state', 'completed')
                if status == 'blocked':
                    status = 'pending'
            except InvalidOperation as error:
                result, status = {'error': str(error)}, 'failed'
            except NativeError:
                result, status = {'error': 'Native result needs reconciliation. Do not resubmit creation.'}, 'uncertain'
            finally:
                self._approved_delete = None
            with self.store.db:
                self.store.db.execute('UPDATE requests SET state=?,result=? WHERE id=?', (status, json.dumps(result), request['id']))
            return {'state': status, 'result': result}
        if operation == 'workspace.initialize':
            fields(params, ['profile', 'handle', 'appearance', 'photo', 'expected_revision'])
            if state['initialized']:
                return snapshot
            detection = await self._invoke('workspace.detect_primary', {})
            if detection.get('profile') != params['profile']:
                raise InvalidOperation('Primary identity changed')
            if params['expected_revision'] != state['revision']:
                raise InvalidOperation('Refresh setup before saving')
            profile = identifier(params['profile'])
            look = appearance(params['appearance'])
            handle = self.handle(state, profiles, profile, params['handle'])
            await self.ops.gateway.call('bot_web.runtime.prepare', {'profile': profile})
            await self.ops.enable_existing(profile)
            if params['photo'] is not None:
                result = await self.ops.gateway.call('profiles.set_asset', {'name': profile, 'asset': 'avatar', 'data': normalize_photo(params['photo'])})
                if result.get('ok') is not True:
                    raise NativeError('Avatar save not confirmed')
            elif look['kind'] == 'photo' and not (await self.ops.gateway.call('profiles.get_asset', {'name': profile, 'asset': 'avatar'})).get('found'):
                raise InvalidOperation('Choose a photo first')
            native_row = next(r for r in await self.ops.profiles() if r['name'] == profile)
            current_title = (native_row.get('ui_meta', {}).get('hermes-bots') or {}).get('title', '')
            title_change = {'title': handle[:1].upper()+handle[1:]} if profile == 'default' and current_title.lower() in {'', 'default', 'hermes'} else {}
            await self.mirror(profile, {'workspaceAppearance': look, 'workspaceHandle': handle, **title_change})
            state['orchestrator'], state['initialized'] = profile, True
            state['bots'][profile].update(enrolled=True, appearance=look, manager=None, manager_id=None)
            self.store.save(state, state['revision'])
            return (await self.sync())[0]
        if operation == 'workspace.welcome':
            fields(params, ['profile'])
            if not state['initialized'] or params['profile'] != state['orchestrator']:
                raise InvalidOperation('Primary workspace agent required')
            from .identity import welcome
            return await welcome(self, state, params['profile'])
        if operation == 'agent.enable':
            fields(params, ['profile', 'initialize_chat'])
            if params['initialize_chat'] is not True:
                raise InvalidOperation('Explicit native initialization required')
            await self.ops.gateway.call('bot_web.runtime.prepare', {'profile': params['profile']})
            result = await self.ops.enable_existing(params['profile'])
            state['bots'][params['profile']]['enrolled'] = True
            self.store.save(state, state['revision'])
            return result
        if operation == 'models.describe':
            fields(params, [])
            return await self.ops.gateway.call('bot_web.models', {'action': 'describe'})
        if operation == 'agent.model':
            fields(params, ['profile', 'source', 'expected', 'expected_revision'])
            if params['source'] != 'default' or params['profile'] not in state['bots'] or params['expected_revision'] != state['revision']:
                raise InvalidOperation('Model grant changed')
            return await self.ops.gateway.call('bot_web.models', {'action': 'grant', 'profile': params['profile'], 'expected': params['expected']})
        if operation == 'agent.create':
            fields(params, ['name', 'display_name', 'soul', 'role', 'model_source', 'model_fingerprint', 'skills', 'toolsets', 'manager', 'team', 'expected_revision'])
            name = bounded(params['name'], 40, False)
            if not re.fullmatch(r'[a-z][a-z0-9-]{1,39}', name) or (name in state['bots'] and state['bots'][name].get('available', True)):
                raise InvalidOperation('Choose a new profile name')
            if params['expected_revision'] != state['revision'] or not state['initialized']:
                raise InvalidOperation('Workspace changed', 'STALE_REVISION')
            display_name = bounded(params['display_name'], 80, False)
            if params['model_source'] != 'default':
                raise InvalidOperation('Choose a supported explicit model grant')
            model = await self.ops.gateway.call('bot_web.models', {'action': 'describe'})
            if not model.get('supported') or model['fingerprint'] != params['model_fingerprint']:
                raise InvalidOperation('Review the current primary model authorization first', 'MODEL_UNAVAILABLE')
            if (params['manager'] is not None and (params['manager'] not in state['bots'] or not state['bots'][params['manager']].get('enrolled'))) or (params['team'] is not None and params['team'] not in {t['id'] for t in state['teams']}):
                raise InvalidOperation('Choose an enrolled manager and existing team')
            if not isinstance(params['skills'], list) or params['skills'] or not isinstance(params['toolsets'], list) or not params['toolsets'] or any(t not in {'workspace', 'skills'} for t in params['toolsets']):
                raise InvalidOperation('Fresh bots start with reviewed workspace/skills tools only; attach other installed resources separately')
            soul = bounded(params['soul'], 12000, False)
            role = bounded(params['role'], 1000)
            result = await self.ops.gateway.call('profiles.create', {'name': name, 'description': role, 'soul': soul,
                'no_alias': True, 'no_skills': True, 'clone_channels': False, 'mirror_credentials': False})
            # The approved source authorizes one selected provider, never all credentials.
            await self.ops.gateway.call('bot_web.runtime.prepare', {'profile': name})
            if result.get('ok') is not True or result.get('soul_written') is not True:
                raise NativeError('Fresh persona creation was not fully confirmed')
            granted = await self.ops.gateway.call('bot_web.models', {'action': 'grant', 'profile': name, 'expected': model['fingerprint']})
            capabilities = await self.ops.gateway.call('profiles.describe', {'name': name})
            attached = await self.ops.gateway.call('profiles.configure', {'name': name, 'disabled_skills': [s['name'] for s in capabilities.get('skills', [])], 'enabled_toolsets': sorted(set(params['toolsets']))})
            if granted.get('configured') is not True or attached.get('applied', {}).get('skills') is not True or attached.get('applied', {}).get('toolsets') is not True:
                return {'state': 'partial', 'profile': name, 'canonical': False, 'runtime': 'unavailable'}
            # Native session.create can eagerly build an agent. Initialize only after its
            # persona, provider, plugin and explicit capabilities have been verified.
            await self.mirror(name, {'title': display_name})
            await self.ops.enable_existing(name)
            await self.sync()
            state = self.store.read()
            from .reporting import assign
            assign(state, name, params['manager'])
            state['bots'][name].update(enrolled=True, team=params['team'], role={'title': '', 'description': role, 'responsibilities': '', 'boundaries': '', 'expectedOutputs': ''})
            self.store.save(state, state['revision'])
            return {'state': 'completed' if granted.get('configured') is True and attached.get('applied', {}).get('toolsets') is True and attached.get('applied', {}).get('skills') is True else 'partial', 'profile': name, 'id': state['bots'][name]['id'], 'created': result.get('ok') is True, 'provider': 'configured' if granted.get('configured') else 'authorization_required', 'runtime': 'unverified', 'canonical': True}
        if operation == 'connections.add':
            fields(params, ['profile', 'recipe', 'name', 'expected_revision'])
            if params['expected_revision'] != state['revision']:
                raise InvalidOperation('Workspace changed', 'STALE_REVISION')
            profile, name = identifier(params['profile']), identifier(params['name'])
            if profile not in state['bots']:
                raise InvalidOperation('Profile unavailable')
            catalog = await self.ops.gateway.call('mcp.catalog', {'profile': profile})
            recipe = next((r for r in catalog.get('servers', []) if r['name'] == params['recipe']), None)
            if not recipe or (recipe.get('transport') not in {'http', 'sse', 'streamable-http'} and not recipe.get('installed')):
                raise InvalidOperation('This service needs native Hermes installation first', 'REQUIRES_SETUP')
            return await self.ops.gateway.call('mcp.servers.add', {'profile': profile, 'name': name, 'preset': recipe['name'], 'config': {'tools': {'include': [], 'resources': False, 'prompts': False}}})
        if operation == 'connections.permissions':
            if set(params) not in ({'profile', 'name'}, {'profile', 'name', 'expected', 'tools'}):
                raise InvalidOperation('Invalid permissions')
            if params['profile'] not in state['bots']:
                raise InvalidOperation('Profile unavailable')
            if 'tools' in params:
                # Only a fresh native discovery result may authorize exact current tool IDs.
                discovered = await self.ops.gateway.call('mcp.servers.test', {'profile': params['profile'], 'name': params['name']})
                if discovered.get('ok') is not True or not isinstance(params['tools'], list) or not set(params['tools']) <= {t['name'] for t in discovered.get('tools', [])}:
                    raise InvalidOperation('Test this connection and select only discovered tools')
            return await self.ops.gateway.call('bot_web.connections.permissions', params)
        if operation == 'connections.set_key':
            fields(params, ['profile', 'name', 'value', 'expected'])
            if params['profile'] not in state['bots'] or not isinstance(params['value'], str) or not 1 <= len(params['value']) <= 4096 or any(ord(c) < 32 for c in params['value']):
                raise InvalidOperation('Invalid credential')
            info = await self.ops.gateway.call('bot_web.connections.permissions', {'profile': params['profile'], 'name': params['name']})
            if not info.get('bearer_supported') or params['expected'] != info['fingerprint']:
                raise InvalidOperation('This connection requires a different authorization method')
            result = await self.ops.gateway.call('mcp.servers.set_api_key', {'profile': params['profile'], 'name': params['name'], 'value': params['value']})
            return {'saved': result.get('ok') is True, 'auth': 'saved', 'runtime': 'unknown'}
        if operation in {'connections.list', 'services.catalog', 'connections.test', 'agent.capabilities'}:
            fields(params, ['profile', 'name'] if operation == 'connections.test' else ['profile'])
            profile = identifier(params['profile'])
            if profile not in state['bots']:
                raise InvalidOperation('Profile unavailable')
            if operation == 'agent.capabilities':
                data = await self.ops.gateway.call('profiles.describe', {'name': profile})
                from agent.skill_utils import ESSENTIAL_SKILLS
                data['skills'] = [{**s, 'required': s['name'] in ESSENTIAL_SKILLS} for s in data.get('skills', [])]
                return {key: data.get(key, []) for key in ['skills', 'toolsets', 'mcp_servers']}
            method = {'connections.list': 'mcp.servers.list', 'services.catalog': 'mcp.catalog', 'connections.test': 'mcp.servers.test'}[operation]
            data = await self.ops.gateway.call(method, {'profile': profile, **({'name': identifier(params['name'])} if operation == 'connections.test' else {})})
            if operation == 'connections.test':
                return {key: data.get(key) for key in ['ok', 'tools', 'oauth_needed', 'tokens_present']} | {'runtime': 'unknown', 'checked_at': int(time.time())}
            return {'servers': [{key: row.get(key) for key in ['name', 'description', 'transport', 'enabled', 'installed', 'auth', 'oauth_tokens_present', 'tools'] if key in row} for row in data.get('servers', [])]}
        if operation == 'agent.attach':
            # Safe initial attachment supports selecting installed native skills/toolsets.
            # No arbitrary code, paths, URLs, credential or subprocess configuration.
            fields(params, ['profile', 'skills', 'toolsets', 'expected_revision'])
            if params['expected_revision'] != state['revision']:
                raise InvalidOperation('Workspace changed', 'STALE_REVISION')
            profile = identifier(params['profile'])
            data = await self.ops.gateway.call('profiles.describe', {'name': profile})
            skills, tools = params['skills'], params['toolsets']
            if not isinstance(skills, list) or not isinstance(tools, list) or not tools:
                raise InvalidOperation('Choose an explicit nonempty toolset list; native empty means defaults')
            installed = {s['name'] for s in data.get('skills', [])}
            available = {t['name'] if isinstance(t, dict) else t for t in data.get('toolsets', [])}
            if not set(skills) <= installed or not set(tools) <= available:
                raise InvalidOperation('Resource unavailable')
            result = await self.ops.gateway.call('profiles.configure', {'name': profile, 'disabled_skills': sorted(installed - set(skills)), 'enabled_toolsets': sorted(set(tools))})
            return {'state': 'completed' if result.get('applied', {}).get('skills') is True and result.get('applied', {}).get('toolsets') is True else 'partial', 'runtime': 'refresh_required'}
        if operation == 'bots.appearance.get':
            fields(params, ['profile'])
            profile = identifier(params['profile'])
            if profile not in state['bots']:
                raise InvalidOperation('Profile unavailable')
            asset = await self.ops.gateway.call('profiles.get_asset', {'name': profile, 'asset': 'avatar'})
            return {'appearance': state['bots'][profile]['appearance'], 'data': asset.get('data') if asset.get('found') else None}
        fields_by_operation = {
            'bots.appearance.update': ['profile', 'appearance', 'photo', 'expected_revision'],
            'bots.update_handle': ['profile', 'handle', 'expected_revision'],
            'roles.update': ['profile', 'role', 'manager', 'team', 'expected_revision'],
            'agent.update': ['profile', 'role', 'manager', 'team', 'expected_revision'],
            'teams.save': ['teams', 'expected_revision'],
            'workspace.set_orchestrator': ['profile', 'expected_revision'],
        }
        if operation not in fields_by_operation:
            raise InvalidOperation('Workspace operation unavailable')
        fields(params, fields_by_operation[operation])
        if type(params['expected_revision']) is not int or params['expected_revision'] != state['revision']:
            raise InvalidOperation('Workspace changed; refresh before saving', 'STALE_REVISION')
        profile = identifier(params['profile']) if 'profile' in params else None
        if profile and profile not in state['bots']:
            raise InvalidOperation('Profile unavailable')
        if operation == 'teams.save':
            teams = params['teams']
            if not isinstance(teams, list) or len(teams) > 100:
                raise InvalidOperation('Invalid teams')
            clean = []
            for team in teams:
                fields(team, ['id', 'name'])
                clean.append({'id': identifier(team['id']), 'name': bounded(team['name'], 80, False)})
            if len({t['id'] for t in clean}) != len(clean) or any(b.get('team') and b['team'] not in {t['id'] for t in clean} for b in state['bots'].values()):
                raise InvalidOperation('Move bots before removing their team', 'INVALID_REPORTING')
            state['teams'] = clean
            for name, bot in state['bots'].items():
                if bot.get('team'):
                    team = next(t for t in clean if t['id'] == bot['team'])
                    await self.mirror(name, {'sectionId': team['id'], 'sectionName': team['name']})
        elif operation == 'workspace.set_orchestrator':
            if not state['bots'][profile].get('enrolled'):
                raise InvalidOperation('Enable this agent first')
            old = state['orchestrator']
            state['orchestrator'] = profile
            from .reporting import assign
            assign(state, profile, None)
            self.graph(state)
        elif operation in {'roles.update', 'agent.update'}:
            role = params['role']
            fields(role, ['title', 'description', 'responsibilities', 'boundaries', 'expectedOutputs'])
            role = {key: bounded(value, ROLE_TEXT_LIMITS[key]) for key, value in role.items()}
            if params['team'] is not None and params['team'] not in {t['id'] for t in state['teams']}:
                raise InvalidOperation('Team unavailable')
            from .reporting import assign
            assign(state, profile, params['manager'])
            state['bots'][profile].update(role=role, team=params['team'])
            self.graph(state)
            team = next((t for t in state['teams'] if t['id'] == params['team']), None)
            await self.mirror(profile, {'workspaceRole': role, 'description': role['description'], 'sectionId': team['id'] if team else None, 'sectionName': team['name'] if team else None}, description=(role['title'] + ': ' + role['description']).strip(': ')[:1000])
        elif operation == 'bots.update_handle':
            handle = self.handle(state, profiles, profile, params['handle'])
            await self.mirror(profile, {'workspaceHandle': handle})
        elif operation == 'bots.appearance.update':
            look = appearance(params['appearance'])
            if params['photo'] is not None:
                photo = normalize_photo(params['photo'])
                result = await self.ops.gateway.call('profiles.set_asset', {'name': profile, 'asset': 'avatar', 'data': photo})
                if result.get('ok') is not True:
                    raise NativeError('Avatar save not confirmed')
            elif look['kind'] == 'photo':
                asset = await self.ops.gateway.call('profiles.get_asset', {'name': profile, 'asset': 'avatar'})
                if not asset.get('found'):
                    raise InvalidOperation('Choose a photo first')
            await self.mirror(profile, {'workspaceAppearance': look})
            state['bots'][profile]['appearance'] = look
        return self.store.save(state, state['revision'])
