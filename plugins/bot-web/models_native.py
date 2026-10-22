"""One selected-provider authorization; OAuth remains owned and resolved by Hermes."""
from copy import deepcopy
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
if __package__:
    from .codex_binding import BindingUnavailable, NativeCodexGrant, observe
else:
    from codex_binding import BindingUnavailable, NativeCodexGrant, observe


@dataclass(frozen=True)
class ApiKeyGrant:
    environment: str
    credential: str


@dataclass(frozen=True)
class CustomGrant:
    name: str
    definition: dict


def register():
    from tui_gateway import server
    if __package__:
        from .compatibility import check_native_adapter
    else:
        from compatibility import check_native_adapter
    current = check_native_adapter()['revision'] == 'af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a'

    def scope(home):
        params = {'hydrate_secrets': False} if current else {}
        return server._session_profile_runtime_scope({'profile_home': str(Path(home).resolve())}, **params)

    def selected():
        from hermes_cli.config import load_config, read_user_config_raw
        from agent.secret_scope import get_secret
        from providers import get_provider_profile
        raw, resolved = read_user_config_raw() or {}, load_config() or {}
        model = raw.get('model') or {}
        provider, name = model.get('provider'), model.get('default')
        if not isinstance(provider, str) or not isinstance(name, str):
            raise BindingUnavailable('MODEL_MISSING', 'Configure the primary model in Hermes first.')
        custom_name = provider.removeprefix('custom:')
        custom = (resolved.get('providers') or {}).get(custom_name)
        plan, reason, kind = None, None, 'unsupported'
        try:
            if isinstance(custom, dict):
                kind = 'selected_custom_provider'
                if not custom.get('base_url'):
                    raise BindingUnavailable('MODEL_MISSING', 'Configure the selected custom provider in Hermes first.')
                plan = CustomGrant(custom_name, deepcopy(custom))
            elif provider == 'openai-codex':
                kind = 'native_oauth'
                if not current:
                    raise BindingUnavailable('NATIVE_UPGRADE_REQUIRED', 'Update Hermes to a supported build with safe shared Codex login refresh before creating this pebble.')
                strategy = (raw.get('credential_pool_strategies') or {}).get(provider, 'fill_first')
                if strategy not in {'fill_first', 'round_robin', 'random', 'least_used'}:
                    strategy = 'fill_first'
                plan = observe(model, strategy)
            else:
                metadata = get_provider_profile(provider)
                kind = 'provider_api_key' if metadata and metadata.auth_type == 'api_key' else 'unsupported'
                if kind == 'unsupported':
                    raise BindingUnavailable('UNSUPPORTED_PROVIDER', 'Pebble Crew cannot share this provider’s login yet.')
                for key in metadata.env_vars:
                    value = get_secret(key)
                    if value:
                        plan = ApiKeyGrant(key, value)
                        break
                if plan is None:
                    raise BindingUnavailable('AUTH_MISSING', 'Set up the selected provider’s API key in Hermes first.')
        except BindingUnavailable as error:
            reason = {'code': error.code, 'message': str(error)}
        public = {'source': 'default', 'provider': provider, 'model': name, 'supported': plan is not None,
                  'auth_kind': kind, 'reason': reason}
        # OAuth identity contains source/principals/routes, never tokens or rotation metadata.
        proof = hashlib.sha256(json.dumps({'model': model, 'kind': kind, 'plan': asdict(plan) if plan else None}, sort_keys=True, default=str).encode()).hexdigest()
        return public | {'fingerprint': proof}, model, plan

    def handler(rid, params):
        try:
            if set(params) not in ({'action'}, {'action', 'profile', 'expected'}):
                raise ValueError()
            from hermes_cli.profiles import get_profile_dir, list_profiles
            with scope(get_profile_dir('default')):
                public, model, plan = selected()
            if params['action'] == 'describe':
                return server._ok(rid, public)
            if params['action'] != 'grant' or params.get('expected') != public['fingerprint']:
                raise BindingUnavailable('MODEL_AUTHORIZATION_CHANGED', 'The primary model authorization changed. Review a new request.')
            if plan is None:
                raise BindingUnavailable(public['reason']['code'], public['reason']['message'])
            if params['profile'] == 'default' or params['profile'] not in {p.name for p in list_profiles()}:
                raise ValueError()
            with scope(get_profile_dir(params['profile'])):
                from hermes_cli.config import read_user_config_raw, save_config, save_env_value
                config = read_user_config_raw() or {}
                config['model'] = {key: value for key, value in model.items() if key in {'provider', 'default', 'base_url', 'api_mode'}}
                if isinstance(plan, NativeCodexGrant) and observe(model, plan.policy['strategy']) != plan:
                    raise BindingUnavailable('AUTH_SOURCE_CHANGED', 'This profile has a different Codex login. Review its model settings in Hermes.')
                if isinstance(plan, NativeCodexGrant):
                    config.setdefault('credential_pool_strategies', {})[public['provider']] = plan.policy['strategy']
                if isinstance(plan, CustomGrant):
                    config.setdefault('providers', {})[plan.name] = plan.definition
                if isinstance(plan, ApiKeyGrant):
                    save_env_value(plan.environment, plan.credential)
                save_config(config)
                if (read_user_config_raw() or {}).get('model') != config['model']:
                    raise ValueError('Model save not confirmed')
                if isinstance(plan, NativeCodexGrant) and observe(model, plan.policy['strategy']) != plan:
                    raise BindingUnavailable('AUTH_SOURCE_CHANGED', 'The shared Codex login changed during setup. Inspect this profile before retrying.')
            return server._ok(rid, {'configured': True, 'provider': public['provider'], 'model': public['model'], 'runtime': 'unverified'})
        except BindingUnavailable as error:
            return server._err(rid, 5072, str(error))
        except Exception:
            return server._err(rid, 5072, 'Specific model grant unavailable or changed')

    server.method('bot_web.models')(handler)
