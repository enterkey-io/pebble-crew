"""Stand-ins for Hermes modules that a test patches but the isolated environment lacks.

Each stand-in is used only when the real module cannot be imported, so a run with
pinned Hermes installed still patches the real module.
"""
import importlib.util
from types import ModuleType


def available(name):
    try:
        return importlib.util.find_spec(name) is not None
    except ModuleNotFoundError:
        return False


def missing_hermes(**modules):
    """Return sys.modules entries for each named module that is not importable."""
    entries = {}
    for name, attributes in modules.items():
        if available(name):
            continue
        module = ModuleType(name)
        for key, value in attributes.items():
            setattr(module, key, value)
        entries[name] = module
        parent, _, child = name.rpartition('.')
        if parent and not available(parent):
            entries.setdefault(parent, ModuleType(parent))
            setattr(entries[parent], child, module)
    return entries


HERMES_STORAGE = available('hermes_state')
NEEDS_HERMES_STORAGE = 'Reads real Hermes session storage; install the pinned Hermes runtime to run it.'
