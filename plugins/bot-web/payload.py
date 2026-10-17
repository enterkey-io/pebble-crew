"""Positive code allowlist used by packaging and profile-runtime provisioning."""
from pathlib import Path

FILES = (
    '__init__.py', 'compatibility.py', 'native.py', 'native_entry.py', 'native_extensions.py',
    'identity.py', 'organization.py', 'search.py', 'search_native.py', 'reactions.py', 'reactions_native.py',
    'operations.py', 'pairing.py', 'server.py', 'setup.py', 'trust.py', 'workspace.py',
    'computer.py', 'screen_native.py', 'attachments.py', 'attachments_native.py', 'crews.py', 'runtime.py', 'room_identity.py', 'connections_native.py', 'models_native.py',
    'payload.py', 'protocol-catalog.json', 'runtime-contract.json', 'plugin.yaml', 'requirements.txt', 'skills/manage-team/SKILL.md',
    'host_install.py', 'host_service.py', 'host_entry.py', 'version.py', 'lifecycle_native.py', 'presentation.py',
)


def payload_paths(source, *, legacy_runtime=False):
    source = Path(source).resolve()
    result = []
    for relative in FILES:
        path = source / relative
        if (legacy_runtime and relative in {'protocol-catalog.json', 'runtime-contract.json'}
            and not path.exists() and not path.is_symlink()):
            continue
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(source):
            raise ValueError('Incomplete integration code payload')
        result.append(path)
    return result


def copy_payload(source, destination, *, legacy_runtime=False):
    import shutil
    source, destination = Path(source).resolve(), Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    for path in payload_paths(source, legacy_runtime=legacy_runtime):
        target = destination / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
