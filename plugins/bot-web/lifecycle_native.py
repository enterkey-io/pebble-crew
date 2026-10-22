"""Fixed native profile lifecycle; never a shell or filesystem deletion API."""
import contextlib
import hashlib
import io
import json
import os
import secrets
import tempfile
from pathlib import Path
import subprocess
import sys
import threading

_lock = threading.Lock()


def incarnation(home):
    path = Path(home)
    if path.is_symlink() or not path.is_dir():
        raise ValueError('Profile directory unavailable')
    stat = path.stat()
    # A nonce survives rename/restart. A cloned folder gets a fresh nonce because
    # its directory witness differs. Recreated names cannot inherit identity even
    # if a filesystem quickly reuses an inode after removal.
    marker = path / '.pebble-crew-identity'
    witness = [stat.st_dev, stat.st_ino]
    value = None
    try:
        fd = os.open(marker, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as source:
            if os.fstat(source.fileno()).st_nlink != 1:
                raise ValueError('Linked profile identity')
            value = json.loads(source.read(512))
        if not isinstance(value, dict) or set(value) != {'witness', 'nonce'} or not isinstance(value['nonce'], str) or len(value['nonce']) != 64:
            raise ValueError('Profile identity is not valid')
    except FileNotFoundError:
        pass
    if value is None or value['witness'] != witness:
        value = {'witness': witness, 'nonce': secrets.token_hex(32)}
        fd, temporary = tempfile.mkstemp(prefix='.pebble-identity-', dir=path)
        try:
            with os.fdopen(fd, 'w') as output:
                json.dump(value, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, marker)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return hashlib.sha256(value['nonce'].encode()).hexdigest()


def read_clock(home):
    from hermes_state import SessionDB
    path = Path(home) / 'state.db'
    if not path.is_file() or path.is_symlink():
        return None
    db = SessionDB(db_path=path, read_only=True)
    try:
        canonical = db.get_session_by_title('Bot Chat')
        if not canonical or canonical.get('archived'):
            return None
        root = canonical['id']
        tip = db.get_compression_tip(root) or root
        return {'conversation_id': root, 'cursor_type': 'row', 'cursor': max(
            db.latest_message_row_id(tip, role='user') or 0,
            db.latest_message_row_id(tip, role='assistant') or 0)}
    finally:
        db.close()


def register():
    from tui_gateway import server

    def connection_health(rid, params):
        if params != {}:
            return server._err(rid, -32602, 'Invalid health request')
        return server._ok(rid, {'responsive': True})
    server.method('bot_web.connection.health')(connection_health)

    def identities(rid, params):
        try:
            if params:
                raise ValueError()
            from hermes_cli.profiles import get_profile_dir, list_profiles
            with _lock:
                profiles = list_profiles()
                clocks = {}
                for profile in profiles:
                    try:
                        clock = read_clock(get_profile_dir(profile.name))
                        if clock is not None:
                            clocks[profile.name] = clock
                    except Exception:
                        pass  # A missing/unreadable transcript never becomes a fabricated clock.
                return server._ok(rid, {'identities': {p.name: incarnation(get_profile_dir(p.name)) for p in profiles}, 'cursors': clocks})
        except Exception:
            return server._err(rid, 5075, 'Profile identities unavailable')
    server.method('bot_web.identities')(identities)

    def lifecycle(rid, params):
        try:
            if not isinstance(params, dict) or params.get('action') not in {'inspect', 'delete'}:
                raise ValueError()
            action = params['action']
            if set(params) != ({'action', 'profile'} if action == 'inspect' else {'action', 'profile', 'incarnation'}):
                raise ValueError()
            from hermes_cli.profiles import get_profile_dir, list_profiles
            name = params['profile']
            if not isinstance(name, str) or name not in {p.name for p in list_profiles()}:
                raise ValueError('Profile unavailable')
            home = Path(get_profile_dir(name))
            stamp = incarnation(home)
            if action == 'inspect':
                return server._ok(rid, {'incarnation': stamp, 'can_delete': name != 'default'})
            with _lock:
                if name == 'default' or params['incarnation'] != stamp:
                    raise ValueError('Protected or changed profile')
                with server._sessions_lock:
                    sessions = [(sid, row) for sid, row in server._sessions.items()
                                if row.get('profile_home') and Path(row['profile_home']).resolve() == home.resolve()]
                    if any(row.get('running') for _, row in sessions):
                        return server._ok(rid, {'state': 'blocked', 'reason': 'Stop active work before deleting this pebble.'})
                # Release this adapter's live handles before native service/identity teardown.
                for sid, _ in sessions:
                    response = server._methods['session.close'](rid, {'session_id': sid})
                    if response.get('error'):
                        raise ValueError('Live session teardown not confirmed')
                # An isolated fixed worker captures native summaries without redirecting
                # stdout globally in this shared gateway (other agents may be streaming).
                result = subprocess.run([sys.executable, str(Path(__file__).resolve()), name, stamp],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=35)
                if result.returncode or len(result.stdout) > 4096:
                    raise ValueError('Native lifecycle result unavailable')
                return server._ok(rid, json.loads(result.stdout))
        except Exception:
            return server._err(rid, 5075, 'Profile lifecycle rejected; refresh the target before proceeding')

    server.method('bot_web.lifecycle')(lifecycle)


def worker(name, expected):
    from hermes_cli.profiles import get_profile_dir, list_profiles, delete_profile
    if name == 'default' or name not in {p.name for p in list_profiles()}:
        raise ValueError()
    home = Path(get_profile_dir(name))
    if incarnation(home) != expected:
        raise ValueError()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            delete_profile(name, yes=True)
            result = {'state': 'completed', 'files_deleted': not home.exists()}
        except Exception as error:
            partial = type(error).__name__ == 'ProfileIdentitySettlementPending'
            result = {'state': 'partial' if partial else 'uncertain', 'files_deleted': not home.exists(),
                'identity_pending': partial, 'reason': 'Native deletion needs reconciliation; do not repeat it.'}
    print(json.dumps(result))


if __name__ == '__main__':
    worker(*sys.argv[1:])
