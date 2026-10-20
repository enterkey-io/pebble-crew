"""Positive code allowlist used by packaging and profile-runtime provisioning."""
from pathlib import Path

PRE_VOICE_FILES = (
    '__init__.py', 'compatibility.py', 'native.py', 'native_entry.py', 'native_extensions.py',
    'identity.py', 'organization.py', 'search.py', 'search_native.py', 'reactions.py', 'reactions_native.py',
    'operations.py', 'pairing.py', 'server.py', 'setup.py', 'trust.py', 'workspace.py',
    'computer.py', 'screen_native.py', 'attachments.py', 'attachments_native.py', 'crews.py', 'runtime.py', 'room_identity.py', 'connections_native.py', 'models_native.py',
    'payload.py', 'protocol-catalog.json', 'runtime-contract.json', 'plugin.yaml', 'requirements.txt', 'skills/manage-team/SKILL.md',
    'host_install.py', 'host_service.py', 'host_entry.py', 'version.py', 'lifecycle_native.py', 'presentation.py',
)


FILES = PRE_VOICE_FILES + ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py', 'documents.py', 'work_store.py', 'work_native.py', 'work.py', 'work_delivery.py', 'skills/manage-work/SKILL.md')

def source_inventory(source):
    """Read a known literal inventory without importing inspected/rollback code."""
    import ast
    path = Path(source) / "payload.py"
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 32_000:
        raise ValueError("Invalid code inventory")
    tree = ast.parse(path.read_text())
    # Historical releases use a literal FILES tuple. Current copies declare the
    # pre-voice tuple and a fixed additive inventory; neither executes code.
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "FILES" for t in node.targets):
            if isinstance(node.value, ast.Tuple):
                names = ast.literal_eval(node.value)
                if names in (PRE_VOICE_FILES, tuple(n for n in PRE_VOICE_FILES if n not in {'protocol-catalog.json', 'runtime-contract.json'})):
                    return names
            if (isinstance(node.value, ast.BinOp) and isinstance(node.value.op, ast.Add)
                and isinstance(node.value.left, ast.Name) and node.value.left.id == 'PRE_VOICE_FILES'
                and isinstance(node.value.right, ast.Tuple)):
                bases = [item.value for item in tree.body if isinstance(item, ast.Assign)
                         and any(isinstance(target, ast.Name) and target.id == 'PRE_VOICE_FILES' for target in item.targets)]
                suffix = ast.literal_eval(node.value.right)
                if len(bases) == 1 and ast.literal_eval(bases[0]) == PRE_VOICE_FILES and suffix in (('live_voice.py',), ('live_voice.py', 'commands.py'), ('live_voice.py', 'commands.py', 'voice_credentials.py'), ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py'), ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py', 'documents.py'), ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py', 'documents.py', 'work_store.py', 'work_native.py', 'work.py', 'skills/manage-work/SKILL.md'), ('live_voice.py', 'commands.py', 'voice_credentials.py', 'reporting.py', 'documents.py', 'work_store.py', 'work_native.py', 'work.py', 'work_delivery.py', 'skills/manage-work/SKILL.md')):
                    return PRE_VOICE_FILES + suffix
    raise ValueError("Unknown code inventory")

def payload_paths(source, *, legacy_runtime=False):
    source = Path(source).resolve()
    result = []
    for relative in source_inventory(source):
        path = source / relative
        if (legacy_runtime and relative in {'protocol-catalog.json', 'runtime-contract.json'}
            and not path.exists() and not path.is_symlink()):
            continue
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(source):
            raise ValueError('Incomplete integration code payload')
        result.append(path)
    # Imports are code dependencies even when they occur inside a request handler.
    # Catch a new module omitted from the positive shipping/runtime inventory.
    import ast
    names = {str(path.relative_to(source)) for path in result}
    missing = set()
    for path in result:
        if path.suffix != '.py':
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module:
                dependency = node.module.split('.')[0] + '.py'
                if dependency not in names:
                    missing.add(dependency)
    if missing:
        raise ValueError('Integration inventory omits local import: ' + ', '.join(sorted(missing)))
    return result


def copy_payload(source, destination, *, legacy_runtime=False):
    import shutil
    source, destination = Path(source).resolve(), Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    for path in payload_paths(source, legacy_runtime=legacy_runtime):
        target = destination / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
