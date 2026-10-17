"""Observe actual tool registration in a fresh disposable process, without inference."""
import importlib.util
import json
from pathlib import Path
import sys

source = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('bot_web', source / '__init__.py',
    submodule_search_locations=[str(source)])
module = importlib.util.module_from_spec(spec)
sys.modules['bot_web'] = module
spec.loader.exec_module(module)
from bot_web.runtime import register_runtime


class Registration:
    def __init__(self):
        self.descriptions = {}

    def register_tool(self, **tool):
        self.descriptions[tool['name']] = tool['description']

    def register_hook(self, *args, **kwargs):
        pass

    register_middleware = register_hook
    register_skill = register_hook


context = Registration()
register_runtime(context)
print(json.dumps(context.descriptions['workspace_agents']))
