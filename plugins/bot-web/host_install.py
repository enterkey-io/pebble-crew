"""Owner-local, immutable releases for the combined installable plugin."""
from contextlib import contextmanager, closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

from .version import VERSION, STATE_SCHEMA

MAX_PAYLOAD_BYTES = 100_000_000


def state_dir():
    from .setup import config_path
    config = config_path()
    # Canonicalize the trusted Hermes home, retaining checks on integration-owned children.
    return config.parent.parent.resolve() / config.parent.name / "web"


def private_dir(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Private installation directories cannot be symbolic links")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name == "posix" and path.stat().st_uid != os.getuid():
        raise ValueError("Run installation as the Hermes service account")
    path.chmod(0o700)
    return path


def read_private(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1_000_000:
        raise ValueError("Invalid private installation file")
    if os.name == "posix" and (path.stat().st_mode & 0o077 or path.stat().st_uid != os.getuid()):
        raise ValueError("Installation files must belong to this account and have mode 0600")
    return json.loads(path.read_text())


def atomic_write(path, value, *, text=False):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Refusing a linked installation file")
    private_dir(path.parent)
    fd, temporary = tempfile.mkstemp(prefix=".workspace-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(value if text else json.dumps(value, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


@contextmanager
def locked(path):
    import fcntl
    private_dir(Path(path).parent)
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    except BlockingIOError as error:
        raise ValueError("Another installation or service already owns this lock") from error
    finally:
        os.close(descriptor)


def payload_files(runtime):
    """Validate every shipped file; dependency installation happens only afterward."""
    runtime = Path(runtime)
    manifest = runtime / "payload.json"
    if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > 1_000_000:
        raise ValueError("Install the combined plugin release; its prebuilt web runtime is missing")
    value = json.loads(manifest.read_text())
    if set(value) != {"schema", "version", "files"} or value["schema"] != 1 or not isinstance(value["files"], dict):
        raise ValueError("Unsupported web runtime manifest")
    result, total = [], 0
    for name, digest in value["files"].items():
        if not isinstance(name, str) or not isinstance(digest, str):
            raise ValueError("Invalid runtime inventory entry")
        parts = PurePosixPath(name)
        if (not isinstance(name, str) or "\\" in name or parts.is_absolute() or ".." in parts.parts
            or not parts.parts or str(parts) != name or not re.fullmatch(r"[a-f0-9]{64}", digest)):
            raise ValueError("Unsafe runtime payload entry")
        path = runtime / name
        if any(part.is_symlink() for part in [path, *path.parents] if part != runtime.parent):
            raise ValueError("Runtime payload cannot contain links")
        if not path.is_file() or not path.resolve().is_relative_to(runtime.resolve()):
            raise ValueError("Incomplete runtime payload")
        total += path.stat().st_size
        if total > MAX_PAYLOAD_BYTES or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("Runtime payload checksum mismatch or size limit exceeded")
        result.append(path)
    required = {"package.json", "package-lock.json", "apps/owner-node/dist/main.mjs",
                "apps/owner-worker/migrations/0001_owner.sql", "apps/web/dist/index.html",
                "apps/web/dist/_headers", "apps/web/dist/version.json"}
    if not required.issubset(value["files"]):
        raise ValueError("Incomplete combined web runtime")
    actual = {str(p.relative_to(runtime)) for p in runtime.rglob("*")
              if p.is_file() and "node_modules" not in p.relative_to(runtime).parts and p != manifest}
    if actual != set(value["files"]):
        raise ValueError("Unlisted files in combined runtime")
    return value, result


def executable(value, name):
    path = shutil.which(value or name)
    if not path or not Path(path).is_file():
        raise ValueError(f"The Hermes host needs {name}; have the installer provision its runtime")
    return str(Path(path).resolve())


def node_runtime(node=None):
    path = executable(node, "node")
    try:
        output = subprocess.check_output([path, "--version"], text=True, timeout=10).strip()
        version = tuple(map(int, output.removeprefix("v").split(".")))
    except (ValueError, subprocess.SubprocessError) as error:
        raise ValueError("Cannot verify the Node runtime") from error
    if version < (22, 13, 0):
        raise ValueError("The combined plugin requires Node 22.13 or newer; Node 26 is recommended")
    return path, output


def choose_port(requested=None, exclude=()):
    if requested is not None and (type(requested) is not int or not 1024 <= requested <= 65535):
        raise ValueError("Use an unoccupied local port from 1024 to 65535")
    for _ in range(8):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", requested or 0))
            value = probe.getsockname()[1]
        if value not in exclude:
            return value
    raise ValueError("Could not reserve distinct local ports")


def check_origin(origin):
    from .setup import https_origin
    canonical, _host = https_origin(origin)
    if canonical != origin:
        raise ValueError("Provide the exact public HTTPS origin, without a trailing slash")
    return canonical


def load_install(directory=None):
    directory = Path(directory or state_dir())
    value = read_private(directory / "install.json")
    required = {"schema", "origin", "web_port", "bridge_port", "node", "python", "hermes_source",
                "hermes_home", "operator_token", "active_release", "previous_release", "supervisor"}
    if set(value) != required or value["schema"] != 1:
        raise ValueError("Unsupported installed web configuration")
    check_origin(value["origin"])
    for key in ("web_port", "bridge_port"):
        if type(value[key]) is not int or not 1024 <= value[key] <= 65535:
            raise ValueError("Invalid installed local port")
    if value["web_port"] == value["bridge_port"] or not re.fullmatch(r"[A-Za-z0-9_-]{43}", value["operator_token"]):
        raise ValueError("Invalid internal service configuration")
    for key in ("active_release", "previous_release"):
        if value[key] is not None and not re.fullmatch(r"[a-f0-9]{24}", value[key]):
            raise ValueError("Invalid installed release reference")
    for key in ("node", "python", "hermes_source", "hermes_home"):
        if not isinstance(value[key], str) or not Path(value[key]).is_absolute():
            raise ValueError("Installation paths must be absolute")
    if value["supervisor"] not in {"external", "systemd-user", "launchd"}:
        raise ValueError("Unsupported supervisor")
    return value


def release_dir(directory, release):
    path = Path(directory) / "releases" / release
    if path.is_symlink() or not path.is_dir():
        raise ValueError("Installed release is missing or linked")
    return path


def run_checked(argv, *, cwd, env=None, timeout=180):
    result = subprocess.run(argv, cwd=cwd, env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=timeout)
    if result.returncode:
        raise ValueError(f"Installation step failed ({Path(argv[0]).name}, exit {result.returncode}); no credentials were logged")


def verify_existing_owner(directory, origin):
    """Resume an interrupted first install without replacing its signing material."""
    from .trust import validate_trust
    import jwt
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    owner = Path(directory) / 'owner'
    if owner.is_symlink():
        raise ValueError('Invalid owner state directory')
    settings = read_private(owner / 'settings.json')
    trust = validate_trust(read_private(owner / 'trust.json'))
    if (settings.get('origin') != origin or settings.get('bridgeUrl') != origin
        or settings.get('installationId') != trust['audience'] or settings.get('keyId') != trust['key_id']
        or trust['origin'] != origin or len(settings.get('authSecret', '')) < 32):
        raise ValueError('Existing owner state belongs to a different installation; no keys were replaced')
    private_key = jwt.algorithms.OKPAlgorithm.from_jwk(json.dumps(settings['signingKey']))
    public_key = jwt.algorithms.OKPAlgorithm.from_jwk(json.dumps(trust['public_key']))
    if private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw) != public_key.public_bytes(Encoding.Raw, PublicFormat.Raw):
        raise ValueError('Existing signing and verification keys disagree; refusing to replace either')
    database = owner / 'owner.sqlite'
    if database.is_symlink() or database.stat().st_mode & 0o077:
        raise ValueError('Invalid existing owner database')
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
        if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('Existing owner database needs repair')
        connection.execute('SELECT id FROM owner_claim LIMIT 1').fetchone()


LEGACY_RUNTIME_FILES = (
    'runtime.py', 'workspace.py', 'operations.py', 'native.py', 'native_entry.py',
    'native_extensions.py', 'reactions.py', 'reactions_native.py', 'identity.py',
    'lifecycle_native.py', 'compatibility.py',
)
LEGACY_RUNTIME_SHA256 = '85fc3adb17cef6b519b9f6f16275828788a84ccdfa2c33b568ff9beec5cfa7f4'


def code_digest(source, names):
    source = Path(source)
    checksums = {}
    for name in names:
        if (not isinstance(name, str) or PurePosixPath(name).is_absolute()
            or '..' in PurePosixPath(name).parts or '\\' in name or str(PurePosixPath(name)) != name):
            raise ValueError('Unsafe runtime inventory entry')
        path = source / name
        if any(part.is_symlink() for part in (path, *path.parents)) or not path.is_file():
            raise ValueError('Runtime code is incomplete or linked')
        checksums[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashlib.sha256(json.dumps(checksums, sort_keys=True).encode()).hexdigest()


def runtime_evidence(source):
    """Inspect code on disk without importing or executing the inspected plugin."""
    source = Path(source)
    from .payload import FILES
    if (source / 'runtime-contract.json').is_symlink():
        raise ValueError('Invalid runtime compatibility declaration')
    names = [name for name in FILES if (source / name).exists()]
    optional_legacy = {'runtime-contract.json', 'protocol-catalog.json'}
    required = set(FILES) if (source / 'runtime-contract.json').exists() else set(FILES) - optional_legacy
    if not required.issubset(names):
        raise ValueError('Runtime code payload is incomplete')
    if not source.is_dir() or 'runtime.py' not in names:
        raise ValueError('Runtime copy is missing')
    digest = code_digest(source, names)
    try:
        import hermes_yaml as yaml
    except ImportError:
        import yaml
    manifest = yaml.safe_load((source / 'plugin.yaml').read_text())
    if not isinstance(manifest, dict) or manifest.get('name') != 'bot-web':
        raise ValueError('Refusing unrelated plugin code')
    path = source / 'runtime-contract.json'
    if path.exists():
        if path.is_symlink() or path.stat().st_size > 4096:
            raise ValueError('Invalid runtime compatibility declaration')
        contract = json.loads(path.read_text())
        if (not isinstance(contract, dict) or set(contract) != {'schema', 'contract', 'accepts'}
            or contract['schema'] != 1 or not isinstance(contract['contract'], str)
            or not isinstance(contract['accepts'], list)
            or not all(isinstance(item, str) for item in contract['accepts'])):
            raise ValueError('Invalid runtime compatibility declaration')
    else:
        legacy = code_digest(source, LEGACY_RUNTIME_FILES) == LEGACY_RUNTIME_SHA256
        contract = {'contract': 'legacy-b642cce' if legacy else None,
                    'accepts': ['legacy-b642cce', 'workspace-runtime-v1'] if legacy else []}
    return {'path': str(source), 'sha256': digest, 'contract': contract['contract'],
            'accepts': contract['accepts'], 'loaded': 'unknown'}


def enrolled_runtime_paths():
    from .workspace import workspace_path
    from hermes_cli.profiles import get_profile_dir
    path = workspace_path()
    if not path.exists():
        return {}
    if path.is_symlink() or (os.name == 'posix' and path.stat().st_mode & 0o077):
        raise ValueError('Invalid private workspace database')
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        row = db.execute('SELECT data FROM workspace WHERE id=1').fetchone()
    bots = json.loads(row[0])['bots'] if row else {}
    result = {}
    for profile, bot in bots.items():
        if not bot.get('enrolled'):
            continue
        if not isinstance(profile, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', profile):
            raise ValueError('Invalid enrolled profile identity')
        home = Path(get_profile_dir(profile))
        if not home.is_dir() or (profile != 'default' and home.is_symlink()):
            raise ValueError('Enrolled profile home is missing or linked')
        if (home / 'plugins').is_symlink():
            raise ValueError('Enrolled plugin directory is linked')
        home = home.resolve()
        if bot.get('native_incarnation'):
            marker = home / '.pebble-crew-identity'
            if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 512 or marker.stat().st_nlink != 1:
                raise ValueError('Enrolled native profile identity is unverified; runtime not touched')
            identity = json.loads(marker.read_text())
            stat = home.stat()
            if (identity.get('witness') != [stat.st_dev, stat.st_ino]
                or not isinstance(identity.get('nonce'), str) or len(identity['nonce']) != 64
                or hashlib.sha256(identity['nonce'].encode()).hexdigest() != bot['native_incarnation']):
                raise ValueError('Enrolled native profile identity changed; runtime not touched')
        result[profile] = home / 'plugins' / 'bot-web'
    return result


def runtime_status(directory=None, *, source=None):
    directory = Path(directory or state_dir())
    package = Path(source or Path(__file__).parent)
    result = {'schema': 1, 'packaged': runtime_evidence(package),
              'active_host': None, 'profiles': [], 'loaded_runtime': 'unknown'}
    if (directory / 'install.json').exists():
        value = load_install(directory)
        active = release_dir(directory, value['active_release'])
        metadata = read_private(active / 'release.json')
        actual = code_digest(active, metadata['files'])
        result['active_host'] = {'release': value['active_release'], 'sha256': actual,
            'integrity': actual[:24] == value['active_release'], 'runtime': runtime_evidence(active)}
    for profile, path in enrolled_runtime_paths().items():
        if not path.exists() and not path.is_symlink():
            result['profiles'].append({'profile': profile, 'path': str(path), 'state': 'not-installed',
                'sha256': None, 'contract': None, 'loaded': 'unknown'})
            continue
        try:
            evidence = runtime_evidence(path)
        except (OSError, ValueError) as error:
            evidence = {'path': str(path), 'sha256': None, 'contract': None,
                        'loaded': 'unknown', 'error': type(error).__name__}
        result['profiles'].append({'profile': profile, **evidence})
    return result


def preflight_runtimes(source):
    host = runtime_evidence(source)
    for profile, path in enrolled_runtime_paths().items():
        # A native managed bot may never have opened through this integration.
        if not path.exists() and not path.is_symlink():
            continue
        try:
            runtime = runtime_evidence(path)
        except (OSError, ValueError) as error:
            raise ValueError(f'Runtime compatibility is unverified for {profile}; inspect runtime-status before activation') from error
        if runtime['contract'] not in host['accepts'] or host['contract'] not in runtime['accepts']:
            raise ValueError(f'Runtime compatibility is unverified for {profile}; preserve the active host and inspect runtime-status')


def stage_release(directory, source, node):
    from .payload import payload_paths
    manifest, runtime_files = payload_files(source / "web-runtime")
    if manifest["version"] != VERSION:
        raise ValueError("Plugin and web runtime release versions disagree")
    files = {str(path.relative_to(source)): path for path in payload_paths(source)}
    files.update({"web-runtime/" + str(path.relative_to(source / "web-runtime")): path for path in runtime_files})
    files["web-runtime/payload.json"] = source / "web-runtime/payload.json"
    checksums = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sorted(files.items())}
    release = hashlib.sha256(json.dumps(checksums, sort_keys=True).encode()).hexdigest()[:24]
    releases = private_dir(directory / "releases")
    target = releases / release
    if target.exists():
        metadata = read_private(target / "release.json")
        if metadata["files"] != checksums or any(
                (target / name).is_symlink() or hashlib.sha256((target / name).read_bytes()).hexdigest() != digest
                for name, digest in checksums.items()):
            raise ValueError("An installed immutable release has changed; do not overwrite it")
        return release
    staged = Path(tempfile.mkdtemp(prefix=".staging-", dir=releases))
    try:
        for name, path in files.items():
            destination = staged / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)
        runtime = staged / "web-runtime"
        npm = shutil.which("npm", path=str(Path(node).parent) + os.pathsep + os.environ.get("PATH", ""))
        if not npm:
            raise ValueError("The Node runtime also needs npm for locked dependency installation")
        env = {**os.environ, "PATH": str(Path(node).parent) + os.pathsep + os.environ.get("PATH", ""),
               "NPM_CONFIG_CACHE": str(private_dir(directory / "npm-cache")), "NPM_CONFIG_USERCONFIG": os.devnull}
        run_checked([node, str(Path(npm).resolve()), "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=runtime, env=env)
        run_checked([node, "--input-type=module", "-e", "await import('better-auth'); await import('jose'); await import('node:sqlite')"], cwd=runtime, env=env, timeout=30)
        sql = runtime / "apps/owner-worker/migrations/0001_owner.sql"
        atomic_write(staged / "release.json", {"schema": 1, "version": VERSION, "state_schema": STATE_SCHEMA,
            "owner_schema_sha256": hashlib.sha256(sql.read_bytes()).hexdigest(), "files": checksums})
        os.replace(staged, target)
        return release
    finally:
        if staged.exists():
            shutil.rmtree(staged)


LAUNCHER = '''# Owner-local stable launcher; installed services always resolve the active release.
import json, os, pathlib, re, sys
state = pathlib.Path(__file__).resolve().parent
value = json.loads((state / "install.json").read_text())
release = value["active_release"]
if not re.fullmatch(r"[a-f0-9]{24}", release):
    raise SystemExit("Invalid installed release")
entry = state / "releases" / release / "host_entry.py"
os.execv(value["python"], [value["python"], str(entry), "manager", "--state", str(state)])
'''


def install(origin, *, directory=None, source=None, node=None, web_port=None,
            bridge_port=None, supervisor="external", update=False):
    from .compatibility import check_native_adapter
    from hermes_constants import get_hermes_home
    if os.name != "posix":
        raise ValueError("This preview supports Linux and macOS Hermes hosts")
    check_native_adapter()
    check_origin(origin)
    node, _node_version = node_runtime(node)
    source = Path(source or Path(__file__).parent).resolve()
    # Verify shipped assets before creating any installation state.
    payload_files(source / "web-runtime")
    directory = private_dir(directory or state_dir())
    with locked(directory / "install.lock"):
        previous = load_install(directory) if (directory / "install.json").exists() else None
        if update and previous is None:
            raise ValueError("There is no combined installation to update")
        if previous:
            if (previous["origin"] != origin or node != previous["node"] or
                (web_port and web_port != previous["web_port"]) or
                (bridge_port and bridge_port != previous["bridge_port"])):
                raise ValueError("Preserve this installation's origin, runtime and ports; relocation needs a migration")
        release = stage_release(directory, source, node)
        preflight_runtimes(release_dir(directory, release))
        if previous and previous["active_release"] == release:
            return {"configured": True, "changed": False, "state": str(directory)}
        if previous and not update:
            raise ValueError("A different release is installed; use the explicit update command")
        if previous:
            old = read_private(release_dir(directory, previous["active_release"]) / "release.json")
            new = read_private(release_dir(directory, release) / "release.json")
            if any(old[k] != new[k] for k in ("state_schema", "owner_schema_sha256")):
                raise ValueError("This release needs a data migration; automatic code-only activation refused")
            value = {**previous, "active_release": release, "previous_release": previous["active_release"]}
        else:
            web_port = choose_port(web_port)
            bridge_port = choose_port(bridge_port, exclude={web_port})
            hermes = importlib.util.find_spec("hermes_cli")
            value = {"schema": 1, "origin": origin, "web_port": web_port, "bridge_port": bridge_port,
                "node": node, "python": sys.executable, "hermes_source": str(Path(hermes.origin).parent.parent.resolve()),
                "hermes_home": str(Path(get_hermes_home()).resolve()), "operator_token": secrets.token_urlsafe(32),
                "active_release": release, "previous_release": None, "supervisor": supervisor}
            runtime = release_dir(directory, release) / "web-runtime"
            if (directory / "owner").exists():
                verify_existing_owner(directory, origin)
            else:
                owner_stage = Path(tempfile.mkdtemp(prefix=".owner-", dir=directory))
                try:
                    run_checked([node, str(runtime / "apps/owner-node/dist/main.mjs"), "init", "--origin", origin,
                        "--bridge", origin, "--state", str(owner_stage)], cwd=runtime, timeout=30)
                    os.replace(owner_stage, directory / "owner")
                finally:
                    if owner_stage.exists():
                        shutil.rmtree(owner_stage)
            atomic_write(directory / "launcher.py", LAUNCHER, text=True)
        atomic_write(directory / "install.json", value)
    return {"configured": True, "changed": True, "state": str(directory), "supervisor": value["supervisor"]}


def rollback(directory=None):
    directory = Path(directory or state_dir())
    with locked(directory / "install.lock"):
        value = load_install(directory)
        if not value["previous_release"]:
            raise ValueError("There is no previous installed release")
        target = release_dir(directory, value["previous_release"])
        preflight_runtimes(target)
        value["active_release"], value["previous_release"] = value["previous_release"], value["active_release"]
        atomic_write(directory / "install.json", value)
    return {"configured": True, "state": str(directory), "activation": "pending verification"}


def setup_link(directory=None, *, renew=False):
    directory = Path(directory or state_dir())
    value = load_install(directory)
    mode = 'rw' if renew else 'ro'
    connection = sqlite3.connect((directory / "owner/owner.sqlite").resolve().as_uri() + "?mode=" + mode, uri=True)
    try:
        if renew:
            connection.execute('BEGIN IMMEDIATE')
        if connection.execute("SELECT COUNT(*) FROM owner_claim").fetchone()[0]:
            raise ValueError("Owner login already exists; use the ordinary app URL")
        if renew:
            proof = secrets.token_urlsafe(32)
            expires = int(time.time() * 1000) + 24 * 60 * 60 * 1000
            atomic_write(directory / 'owner/setup-code.txt', proof + '\n', text=True)
            connection.execute('INSERT OR REPLACE INTO owner_setup(id,value,expires) VALUES(1,?,?)',
                (hashlib.sha256(proof.encode()).hexdigest(), expires))
            connection.commit()
        row = connection.execute("SELECT value,expires FROM owner_setup WHERE id=1").fetchone()
    finally:
        connection.close()
    proof_path = directory / "owner/setup-code.txt"
    if proof_path.is_symlink() or proof_path.stat().st_mode & 0o077:
        raise ValueError("Invalid private owner proof")
    proof = proof_path.read_text().strip()
    if (not re.fullmatch(r"[A-Za-z0-9_-]{43}", proof) or not row or row[1] <= time.time() * 1000
        or hashlib.sha256(proof.encode()).hexdigest() != row[0]):
        raise ValueError("The owner setup proof expired or was already used")
    destination = directory / "setup-link.txt"
    atomic_write(destination, value["origin"] + "/#setup=" + proof + "\n", text=True)
    return {"private_setup_link_file": str(destination), "expires": row[1],
            "expires_in": max(0, int((row[1] - time.time() * 1000) / 1000))}
