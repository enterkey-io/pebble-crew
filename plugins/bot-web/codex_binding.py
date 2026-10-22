"""Read-only evidence for native shared Codex auth. Never selects or refreshes a token."""
import json
from dataclasses import dataclass
from pathlib import Path


class BindingUnavailable(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def read_store(path):
    if path is None:
        return {}
    try:
        with Path(path).open('rb') as source:
            data = source.read(2_000_001)
    except FileNotFoundError:
        return {}
    except OSError as error:
        raise BindingUnavailable('AUTH_UNREADABLE', 'Hermes could not read its saved Codex login. Check it in Hermes.') from error
    try:
        if len(data) > 2_000_000:
            raise ValueError()
        store = json.loads(data.decode('utf-8-sig'))
        if not isinstance(store, dict) or any(key in store and not isinstance(store[key], dict) for key in ('providers', 'credential_pool')):
            raise ValueError()
        return store
    except (ValueError, UnicodeError) as error:
        # Native's general loader can create a corruption backup. A grant check must not.
        raise BindingUnavailable('AUTH_INVALID', 'Hermes’s saved Codex login could not be read. Check it in Hermes.') from error


@dataclass(frozen=True)
class NativeCodexGrant:
    policy: dict


def observe(model, strategy='fill_first'):
    from hermes_cli.auth import _auth_file_path, _global_auth_file_path
    from agent.credential_pool import _codex_principal_identity
    from hermes_cli.runtime_provider import _pool_entry_mode_and_url
    def route(base=''):
        # Evaluate the prospective approved model, not the target's previous model.
        return _pool_entry_mode_and_url('openai-codex', None, model, '', base or '')[1]
    local_path, root_path = _auth_file_path(), _global_auth_file_path()
    local, root = read_store(local_path), read_store(root_path)
    provider = 'openai-codex'
    local_state = local.get('providers', {}).get(provider)
    state = local_state if isinstance(local_state, dict) else root.get('providers', {}).get(provider)
    state_path = local_path if isinstance(local_state, dict) else root_path
    local_pool = local.get('credential_pool', {}).get(provider)
    pool = local_pool if isinstance(local_pool, list) and local_pool else root.get('credential_pool', {}).get(provider, [])
    pool_path = local_path if isinstance(local_pool, list) and local_pool else root_path
    if not isinstance(pool, list) or len(pool) > 100:
        raise BindingUnavailable('AUTH_INVALID', 'Check the Codex login pool in Hermes.')
    def principal(tokens):
        if not isinstance(tokens, dict) or not all(isinstance(tokens.get(k), str) and tokens[k].strip() for k in ('access_token', 'refresh_token')):
            raise BindingUnavailable('AUTH_MISSING', 'Sign in to Codex in Hermes before creating this pebble.')
        identity = _codex_principal_identity(tokens['access_token'])
        if identity is None:
            raise BindingUnavailable('AUTH_IDENTITY_UNAVAILABLE', 'Hermes could not identify the saved Codex login. Check it in Hermes.')
        return identity
    singleton = None
    if isinstance(state, dict):
        singleton = {'store': str(Path(state_path).resolve()), 'principal': principal(state.get('tokens')), 'route': route()}
    entries = []
    for row in pool:
        if not isinstance(row, dict):
            raise BindingUnavailable('AUTH_INVALID', 'Check the Codex login pool in Hermes.')
        identity = principal(row)
        entry = {'store': str(Path(pool_path).resolve()), 'principal': identity,
                 'route': route(row.get('base_url')),
                 'disabled': row.get('disabled', False)}
        # Native materializes singleton aliases while rotating. That is not a new grant.
        if singleton and identity == singleton['principal'] and entry['store'] == singleton['store'] and entry['route'] == singleton['route'] and not entry['disabled'] and row.get('source') in {'device_code', 'manual:device_code'}:
            continue
        entries.append(entry)
    if singleton is None and not entries:
        raise BindingUnavailable('AUTH_MISSING', 'Sign in to Codex in Hermes before creating this pebble.')
    if any(model.get(key) for key in ('openai_runtime', 'api_key', 'api')):
        raise BindingUnavailable('UNSUPPORTED_ROUTE', 'This Codex runtime route cannot be shared by Pebble Crew yet.')
    return NativeCodexGrant({'singleton': singleton, 'pool': sorted({json.dumps(r, sort_keys=True) for r in entries}),
                             'route': route(), 'strategy': strategy})
