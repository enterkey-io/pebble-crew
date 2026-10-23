"""Native MCP discovery and cron persistence. No model, tool invocation or job execution."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime
import asyncio
import re
from .work_store import fingerprint

READ_TOOLS = {
    'calendar': {'calendar_list_events', 'google_calendar_list_events', 'gcal_list_events', 'google-calendar.list_events', 'gcal_search_events'},
    'inbox': {'gmail_search', 'gmail_search_messages', 'gmail_list_messages', 'gmail.search_messages', 'gmail.search', 'outlook_list_messages', 'outlook_search_messages'},
}


def definitions(name, config):
    """Use Hermes's transport/secret isolation, retaining actual tool schemas before shutdown."""
    from hermes_cli import mcp_config
    from tools import mcp_tool
    # Initialize Hermes's lazy optional SDK on the calling thread before transport startup.
    initialize = getattr(mcp_tool, '_ensure_mcp_sdk', None)
    if initialize:
        initialize()
    if getattr(mcp_tool, 'ClientSession', None) is None:
        raise RuntimeError('Native MCP discovery is unavailable')
    try:
        from tools.mcp_tool_loop import _ensure_mcp_loop, _run_on_mcp_loop
        from tools.mcp_tool_discovery import _connect_server
        from tools.mcp_tool_lifecycle import _stop_mcp_loop_if_idle
    except ImportError:
        from tools.mcp_tool import _ensure_mcp_loop, _run_on_mcp_loop, _connect_server, _stop_mcp_loop_if_idle
    probe = mcp_config._resolve_mcp_server_config({**config, 'connect_timeout': 3,
        'sampling': {'enabled': False}, 'elicitation': {'enabled': False}})
    async def read():
        connection = await asyncio.wait_for(_connect_server(name, probe), timeout=3)
        try:
            return [{'name': t.name, 'description': getattr(t, 'description', '') or '',
                'schema': getattr(t, 'inputSchema', {}),
                'annotations': getattr(t, 'annotations', None).model_dump(mode='json') if getattr(t, 'annotations', None) is not None else None}
                for t in connection._tools[:1000]]
        finally:
            await connection.shutdown()
    _ensure_mcp_loop()
    try:
        return _run_on_mcp_loop(read(), timeout=6)
    finally:
        _stop_mcp_loop_if_idle()


def enabled_server(config):
    try:
        from tools.mcp_tool_common import mcp_server_enabled
        return mcp_server_enabled(config)
    except ImportError:
        from tools.mcp_tool import _parse_boolish
        return _parse_boolish(config.get('enabled', True), default=True)


def allowed_tool(name, config, tool):
    try:
        from tools.mcp_tool_registration import _make_tool_filter
        return _make_tool_filter(name, config)(tool)
    except ImportError:
        from tools.mcp_tool import _normalize_name_filter, matches_name_filter
        filters = config.get('tools') or {}
        include, exclude = filters.get('include'), filters.get('exclude')
        return matches_name_filter(tool, _normalize_name_filter(include, 'include')) if isinstance(include, (str, list, tuple, set)) else not matches_name_filter(tool, _normalize_name_filter(exclude, 'exclude'))


class NativeProactive:
    def __init__(self, profile):
        self.profile = profile

    @contextmanager
    def scoped(self):
        from tui_gateway import server
        from hermes_cli.profiles import get_profile_dir
        from cron.jobs import use_cron_store
        home = get_profile_dir(self.profile)
        with server._session_profile_runtime_scope({'profile_home': str(home.resolve())}), use_cron_store(home):
            yield

    def timezone(self):
        import hermes_time
        hermes_time.reset_cache()
        native_name = getattr(hermes_time, 'get_timezone_name', None)
        name = native_name() if native_name else getattr(hermes_time.get_timezone(), 'key', '')
        return name or 'Server local (' + datetime.now().astimezone().strftime('%Z, UTC%z') + ')'

    def discover(self):
        # SDK imports are process-wide; initialize before entering native profile secret scope.
        import importlib
        try:
            importlib.import_module('mcp')
            importlib.import_module('mcp.client.stdio')
            sdk_available = True
        except ImportError:
            sdk_available = False
        from hermes_cli import mcp_config
        with self.scoped():
            configs = deepcopy(mcp_config._get_mcp_servers())
            capabilities = []
            unavailable = 0
            for name, config in sorted(configs.items())[:4]:
                if not isinstance(config, dict) or not enabled_server(config):
                    continue
                try:
                    if not sdk_available:
                        raise RuntimeError('Native MCP is not available')
                    if config.get('auth') == 'oauth' and not mcp_config._oauth_tokens_present(name):
                        raise ValueError('Not authorized')
                    tools = definitions(name, config)
                    for definition in tools:
                        tool = definition['name']
                        if not isinstance(tool, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', tool):
                            continue
                        if not allowed_tool(name, config, tool):
                            continue
                        for family, names in READ_TOOLS.items():
                            if tool in names:
                                capabilities.append({'family': family, 'server': name, 'tool': tool, 'definition': fingerprint(definition)})
                except Exception:
                    unavailable += 1
            # Fingerprints contain no credential values; do not return raw native config.
            return {'fingerprint': fingerprint({'profile': self.profile, 'config': configs, 'capabilities': capabilities}),
                'capabilities': capabilities, 'timezone': self.timezone(), 'unavailable': unavailable + max(0, len(configs) - 4)}

    def jobs(self):
        from cron.jobs import list_jobs
        with self.scoped():
            return list_jobs(include_disabled=True)

    def job(self, ident):
        from cron.jobs import get_job
        with self.scoped():
            return get_job(ident)

    def create(self, spec):
        from cron.jobs import create_job
        with self.scoped():
            return create_job(prompt=spec['prompt'], schedule=spec['schedule'], name=spec['name'], deliver='bot-chat')
