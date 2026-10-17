"""Configure only the native bridge on the Hermes host; web hosting is independent."""
import json
import os
import re
from pathlib import Path
import secrets
from urllib.parse import urlsplit
import urllib.request


def config_path():
    from hermes_constants import get_hermes_home
    return Path(get_hermes_home()) / "bot-web" / "connection.json"


def https_origin(value):
    if not isinstance(value, str) or any(ord(char) <= 32 or ord(char) == 127 for char in value) or "\\" in value:
        raise ValueError("Use an HTTPS origin without credentials, a path, query or fragment")
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise ValueError("Use an HTTPS origin without credentials, a path, query or fragment")
    hostname = parsed.hostname.encode("idna").decode().lower()
    if ":" in hostname:
        hostname = f"[{hostname}]"
    authority = hostname + (f":{parsed.port}" if parsed.port and parsed.port != 443 else "")
    return f"https://{authority}", authority


def validate(settings):
    if not isinstance(settings, dict) or set(settings) != {"schema", "bridge_url", "origins", "host", "token", "port"} or settings["schema"] != 2:
        raise ValueError("Unsupported bridge configuration; do not overwrite existing settings")
    url, host = https_origin(settings["bridge_url"])
    if url != settings["bridge_url"] or host != settings["host"]:
        raise ValueError("Invalid bridge URL/Host configuration")
    origins = settings["origins"]
    if not isinstance(origins, list) or not 1 <= len(origins) <= 8 or len(set(origins)) != len(origins):
        raise ValueError("Configure one to eight exact application origins")
    if any(https_origin(origin)[0] != origin for origin in origins):
        raise ValueError("Invalid application origin")
    if not isinstance(settings["token"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", settings["token"]):
        raise ValueError("Invalid bridge administrator credential")
    if type(settings["port"]) is not int or not 1024 <= settings["port"] <= 65535:
        raise ValueError("Use a local port from 1024 to 65535")
    return settings


def read_settings():
    path = config_path()
    if path.is_symlink() or path.stat().st_size > 65536:
        raise ValueError("Invalid private bridge configuration")
    if os.name != "nt" and path.stat().st_mode & 0o077:
        raise ValueError("Bridge configuration must be private (chmod 600)")
    return validate(json.loads(path.read_text()))


def configure(bridge_url, app_origins, port):
    from .compatibility import check_native_adapter
    check_native_adapter()
    url, host = https_origin(bridge_url)
    origins = list(dict.fromkeys(https_origin(origin)[0] for origin in app_origins))
    settings = validate({"schema": 2, "bridge_url": url, "origins": origins, "host": host,
                         "token": secrets.token_urlsafe(32), "port": port})
    path = config_path()
    if path.exists() or path.is_symlink():
        raise ValueError("Bridge is already configured; preserve existing settings")
    if path.parent.is_symlink():
        raise ValueError("Private configuration directory cannot be a symlink")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(settings, output)
    print(f"Hermes bridge configured. Start it with: hermes bot-web serve\nHermes connection address: {url}\nAllowed web apps: {', '.join(origins)}\nWeb hosting is separate. No administrator credential needs to be sent to the owner.")


def control(action, code=None, app_origin=None, *, all_browsers=False):
    if action == "revoke" and all_browsers is not True:
        raise ValueError("Global revocation requires revoke --all; use DELETE /v1/connect for probe cleanup")
    settings = read_settings()
    if app_origin:
        origin = https_origin(app_origin)[0]
        if origin not in settings["origins"]:
            raise ValueError("This application origin is not configured")
    elif len(settings["origins"]) == 1:
        origin = settings["origins"][0]
    else:
        raise ValueError("Specify --app-origin for the browser being approved")
    payload = {"code": code} if action == "approve" else {"all": True}
    request = urllib.request.Request(f"http://127.0.0.1:{settings['port']}/v1/pairing/{action}",
        data=json.dumps(payload).encode(), method="POST", headers={
            "Host": settings["host"], "Origin": origin,
            "Authorization": "Bearer " + settings["token"], "Content-Type": "application/json"})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=10) as response:
            json.loads(response.read(65536))
    except Exception as error:
        raise ValueError("Cannot complete browser access control. Check that the bridge is running and the code and application origin are current.") from error
    print(f"Browser approved for {origin}. The owner can return to the web app." if action == "approve" else "All browser access revoked; every browser must pair again.")


def bind_primary(profile):
    from hermes_cli.profiles import list_profiles
    if profile not in {p.name for p in list_profiles()}:
        raise ValueError('Choose a verified existing native profile')
    destination = config_path().with_name('primary.json')
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = destination.with_name('primary.new')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump({'schema': 1, 'profile': profile}, stream)
    os.replace(temporary, destination)


def installed_primary():
    path = config_path().with_name('primary.json')
    if not path.exists():
        return None
    value = json.loads(path.read_text())
    if set(value) != {'schema', 'profile'} or value['schema'] != 1 or not isinstance(value['profile'], str):
        raise ValueError('Invalid operator primary binding')
    return value['profile']


def sync_runtime(*, native_idle=False, source_package=False):
    """Copy a compatible runtime only after the operator has stopped native work."""
    from . import host_install as host
    from .payload import copy_payload
    from .workspace import workspace_path
    import shutil
    import uuid
    if not native_idle:
        raise ValueError('Stop native work and profile processes, then use sync-runtime --native-idle. Copying files cannot reload running processes.')
    directory = host.state_dir()
    receipt_root = workspace_path().parent / 'rollback' / uuid.uuid4().hex
    report = {'schema': 1, 'complete': False, 'profiles': [], 'loaded_runtime': 'unknown',
              'next': 'Restart stopped profile processes before resuming native work.',
              'receipt': str(receipt_root / 'receipt.json')}
    lock = directory / 'install.lock' if (directory / 'install.json').exists() else workspace_path().parent / 'runtime-sync.lock'
    with host.locked(lock):
        package = Path(__file__).parent.resolve()
        source = package
        if (directory / 'install.json').exists() and not source_package:
            value = host.load_install(directory)
            source = host.release_dir(directory, value['active_release'])
        report['source'] = host.runtime_evidence(source)
        report['source_kind'] = 'package' if source == package else 'active-release'
        report['idle_evidence'] = 'operator-confirmed; not process observation'
        if source_package and (directory / 'install.json').exists():
            active = host.load_install(directory)['active_release']
            running = host.runtime_evidence(host.release_dir(directory, active))
            if (report['source']['contract'] not in running['accepts']
                or running['contract'] not in report['source']['accepts']):
                raise ValueError('The staged runtime and active host have no tested compatibility; preserve both until a migration is available')
        host.preflight_runtimes(source)
        host.private_dir(receipt_root.parent)
        host.atomic_write(receipt_root / 'receipt.json', report)
        try:
            for profile, destination in host.enrolled_runtime_paths().items():
                row = {'profile': profile, 'destination': str(destination), 'source_sha256': report['source']['sha256'],
                       'before_sha256': host.runtime_evidence(destination)['sha256'] if destination.exists() else None, 'backup': None,
                       'status': 'pending', 'loaded': 'unknown'}
                report['profiles'].append(row)
                if destination.resolve() in {source.resolve(), package}:
                    row['status'] = 'source-package-preserved'
                    continue
                if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
                    raise ValueError('Refusing an invalid or linked runtime directory')
                temporary = destination.with_name('.bot-web-next')
                previous = destination.with_name('.bot-web-previous')
                if any(path.exists() or path.is_symlink() for path in (temporary, previous)):
                    raise ValueError('An earlier runtime update needs reconciliation')
                if any(path.is_symlink() for path in destination.rglob('*')):
                    raise ValueError('Refusing linked files in a runtime backup')
                if destination.exists():
                    backup = receipt_root / profile
                    shutil.copytree(destination, backup)
                    for path in [backup, *backup.rglob('*')]:
                        path.chmod(0o700 if path.is_dir() else 0o600)
                    row['backup'] = str(backup)
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                host.atomic_write(receipt_root / 'receipt.json', report)
                try:
                    if report['source']['contract'] == 'legacy-b642cce':
                        copy_payload(source, temporary, legacy_runtime=True)
                    else:
                        copy_payload(source, temporary)
                    if host.runtime_evidence(temporary)['sha256'] != report['source']['sha256']:
                        raise ValueError('Staged runtime differs from its source')
                    if destination.exists():
                        os.replace(destination, previous)
                    os.replace(temporary, destination)
                except BaseException:
                    if temporary.exists():
                        shutil.rmtree(temporary)
                    if previous.exists() and not destination.exists():
                        os.replace(previous, destination)
                    row['status'] = 'failed'
                    raise
                row['status'] = 'copied'
                row['after_sha256'] = host.runtime_evidence(destination)['sha256']
                host.atomic_write(receipt_root / 'receipt.json', report)
                if previous.exists():
                    shutil.rmtree(previous)
            report['complete'] = True
        except BaseException:
            if report['profiles'] and report['profiles'][-1]['status'] == 'pending':
                report['profiles'][-1]['status'] = 'failed'
            host.atomic_write(receipt_root / 'receipt.json', report)
            print(json.dumps(report))
            raise
        report['runtime_copies_updated'] = sum(row['status'] == 'copied' for row in report['profiles'])
        host.atomic_write(receipt_root / 'receipt.json', report)
    print(json.dumps(report))
    return report


def read_event_frame(response):
    """Read bounded NDJSON, accepting both deployed newline separator styles."""
    for _ in range(9):
        line = response.readline(8193)
        if not line or not line.endswith(b'\n'):
            raise ValueError('Event stream ended before a complete frame')
        if len(line) > 8192:
            raise ValueError('Event frame exceeds probe limit')
        if not line.strip():
            continue
        event = json.loads(line)
        if not isinstance(event, dict):
            raise ValueError('Invalid event frame')
        return event
    raise ValueError('Too many empty event lines')


def probe():
    """Full-route operator probe; release its own lease, never revoke browser grants."""
    from .trust import OwnerTrust
    import time
    settings = read_settings()
    trust = OwnerTrust.installed()
    if not trust:
        raise ValueError('Enroll the owner app before installed-owner verification')
    origin = trust.value['origin']
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect())
    def request(path, method='GET', connection=None):
        headers = {'Origin': origin, 'Authorization': 'Bearer '+settings['token']}
        if connection:
            headers['X-Bot-Connection'] = connection
        return opener.open(urllib.request.Request(settings['bridge_url']+path, method=method, headers=headers), timeout=25)
    connection = None
    try:
        with request('/v1/connect', 'POST') as response:
            connected = json.load(response)
        connection = connected['connection']
        with request('/v1/events', connection=connection) as response:
            ready = read_event_frame(response)
            if ready != {'type': 'bridge.ready'}:
                raise ValueError('Live stream did not become ready')
            deadline = time.monotonic()+20
            while time.monotonic() < deadline:
                event = read_event_frame(response)
                if event == {'type': 'bridge.heartbeat'}:
                    break
            else:
                raise ValueError('No heartbeat received')
        with opener.open(origin+'/.well-known/hermes-workspace.json', timeout=15) as response:
            binding = json.load(response)
        if binding != trust.value:
            raise ValueError('App verification key and enrolled Hermes trust differ')
        print(json.dumps({'full_https_bridge': 'pass', 'live_stream': 'pass', 'heartbeat': 'pass',
            'owner_app_trust_matches': True, 'model_calls': 0, 'profiles_changed': 0}))
    finally:
        if connection:
            with request('/v1/connect', 'DELETE', connection) as response:
                response.read()
