"""Explicit service entry point. Plugin discovery never starts a server."""
import importlib.util
from pathlib import Path
import sys


def load_code(name='bot_web'):
    code = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(name, code / "__init__.py",
        submodule_search_locations=[str(code)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main():
    load_code()
    from bot_web.host_service import main as run
    run()


if __name__ == "__main__":
    main()
