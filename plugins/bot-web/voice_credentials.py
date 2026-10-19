"""One owner-approved native credential source; never a second copy of its key."""
from contextlib import closing
import hashlib
import json


def fingerprint(key, base):
    return hashlib.sha256(json.dumps([key, base], separators=(',', ':')).encode()).hexdigest()


def read_source():
    from .workspace import WorkspaceStore, workspace_path
    store = WorkspaceStore(workspace_path())
    with closing(store.db) as db:
        row = db.execute('SELECT profile,fingerprint FROM voice_credential WHERE id=1').fetchone()
        return row


def confirm_source(profile, key, base):
    if not key:
        raise ValueError('No saved voice credential')
    from .workspace import WorkspaceStore, workspace_path
    store = WorkspaceStore(workspace_path())
    with closing(store.db) as db, db:
        db.execute('INSERT INTO voice_credential VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile,fingerprint=excluded.fingerprint',
                   (profile, fingerprint(key, base)))


def native_source(profile):
    from hermes_cli.web_server_profiles import _config_profile_scope
    from hermes_cli.profiles import profile_exists
    from tools import voice_live as native
    if not profile_exists(profile):
        return {'profile': profile, 'key': '', 'base': '', 'confirmed': False,
                'legacy_approval': False, 'can_change_key': True}
    with _config_profile_scope(profile):
        live = native._live_section()
        key, base = native._resolve_credentials(live)
        legacy_approval = live.get('pebble_key_confirmed') is True or live.get('pebble_setup_complete') is True
        return {'profile': profile, 'key': key, 'base': base,
                'confirmed': False, 'legacy_approval': legacy_approval,
                'can_change_key': not bool(live.get('api_key'))}


def resolve_source():
    from hermes_constants import get_hermes_home
    from tools.bot_mode_probe import _profile_name
    saved = read_source()
    if saved:
        profile, accepted = saved
        source = native_source(profile)
        source['confirmed'] = bool(source['key']) and fingerprint(source['key'], source['base']) == accepted
        return source
    current = native_source(_profile_name(get_hermes_home()))
    primary = current if current['profile'] == 'default' else native_source('default')
    source = next((item for item in (current, primary) if item['key'] and item['legacy_approval']),
                  current if current['key'] else primary)
    if source['key'] and source['legacy_approval']:
        confirm_source(source['profile'], source['key'], source['base'])
        source['confirmed'] = True
    return source


def save_shared_key(value):
    from hermes_cli.web_server_profiles import _config_profile_scope
    from hermes_cli.config import save_env_value_secure, load_env
    from tools import voice_live as native
    with _config_profile_scope('default'):
        if native._live_section().get('api_key'):
            raise ValueError('The shared voice account has an explicitly configured key')
        receipt = save_env_value_secure('VOICE_TOOLS_OPENAI_KEY', value)
        if receipt.get('success') is not True or load_env().get('VOICE_TOOLS_OPENAI_KEY') != value:
            raise ValueError('Native secret save not confirmed')
    source = native_source('default')
    if source['key'] != value:
        raise ValueError('Native voice credential could not be confirmed')
    confirm_source('default', source['key'], source['base'])
