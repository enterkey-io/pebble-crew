"""Version-specific lifecycle adapter. Never patches or replaces Hermes handlers."""

from tui_gateway import entry
from tui_gateway.methods_groups import start_hosted_room_service, stop_hosted_room_service


def main():
    from pathlib import Path
    from native_extensions import register
    register(Path(__file__).parent)
    from connections_native import register as register_connections
    register_connections(Path(__file__).parent)
    from models_native import register as register_models
    register_models()
    from lifecycle_native import register as register_lifecycle
    register_lifecycle()
    from attachments_native import register as register_attachments
    register_attachments()
    from screen_native import register as register_screen
    register_screen()
    from search_native import register as register_search
    register_search()
    from reactions_native import register as register_reactions
    register_reactions()
    from host_entry import load_code
    from importlib import import_module
    package = load_code('_pebble_work_adapter')
    import_module(package.__name__ + '.work').register_native()
    start_hosted_room_service()
    try:
        entry.main()
    finally:
        stop_hosted_room_service(timeout=5.0)


if __name__ == "__main__":
    main()
