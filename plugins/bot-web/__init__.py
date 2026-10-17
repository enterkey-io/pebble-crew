"""Installable owner-hosted workspace; registration has no network side effects."""


def register(ctx):
    def setup(parser):
        parser.add_argument("action", choices=["doctor", "serve", "setup", "approve", "revoke", "enroll", "primary", "sync-runtime", "runtime-status", "probe", "install", "run", "service", "status", "verify", "setup-link", "update", "rollback"],
            help="revoke invalidates ALL browser access; it is not diagnostic connection cleanup")
        parser.add_argument("code", nargs="?")
        parser.add_argument("--source-package", action="store_true", help="Sync runtime from the newly installed plugin package before host update")
        parser.add_argument("--native-idle", action="store_true", help="Confirm native work and profile processes are stopped before copying runtime files")
        parser.add_argument("--trust-file")
        parser.add_argument("--bridge-url")
        parser.add_argument("--app-origin", action="append")
        parser.add_argument("--port", type=int, default=8788)
        parser.add_argument("--origin")
        parser.add_argument("--web-port", type=int)
        parser.add_argument("--bridge-port", type=int)
        parser.add_argument("--node")
        parser.add_argument("--supervisor", choices=["external", "systemd-user", "launchd"], default="external")
        parser.add_argument("--public", action="store_true", help="Verify the real HTTPS route")
        parser.add_argument("--ca-file", help="Additional trusted CA for an operator-controlled private HTTPS route")
        parser.add_argument("--renew-setup", action="store_true", help="Replace only an unclaimed initial setup proof")
        parser.add_argument("--all", action="store_true", help="Required with revoke: invalidate every legacy browser grant and all connection leases")

    def run(args):
        if args.action == "revoke" and not args.all:
            raise ValueError("Global revocation requires revoke --all. For probe cleanup, DELETE /v1/connect with only the probe's own lease.")
        if args.action in {"install", "run", "service", "status", "verify", "setup-link", "update", "rollback"}:
            import asyncio
            import json
            from . import host_install, host_service
            directory = host_install.state_dir()
            if args.action in {"install", "update"}:
                origin = args.origin or (host_install.load_install(directory)["origin"] if args.action == "update" else None)
                if not origin:
                    raise ValueError("Installation requires the owner's chosen public HTTPS origin")
                result = host_install.install(origin, node=args.node, web_port=args.web_port,
                    bridge_port=args.bridge_port, supervisor=args.supervisor, update=args.action == "update")
                host_service.supervisor_files(directory)
                if args.action == "update":
                    try:
                        result.update(host_service.wait_ready(directory))
                    except Exception:
                        if result["changed"]:
                            host_install.rollback(directory)
                            host_service.wait_ready(directory)
                        raise ValueError("Update activation failed; the previous release was restored") from None
            elif args.action == "run":
                asyncio.run(host_service.manager(directory))
                return
            elif args.action == "service":
                result = host_service.enable_supervisor(directory)
            elif args.action in {"status", "verify"}:
                result = host_service.status(directory, public=args.public, stream=args.action == "verify", ca_file=args.ca_file)
            elif args.action == "setup-link":
                result = host_install.setup_link(directory, renew=args.renew_setup)
            else:
                result = host_install.rollback(directory)
                result.update(host_service.wait_ready(directory))
            print(json.dumps(result, indent=2))
            if result.get("ready") is False:
                raise SystemExit(2)
            return
        if args.action == "doctor":
            import json
            from .compatibility import inspect_native_adapter
            report = inspect_native_adapter()
            from .setup import config_path
            from .trust import trust_path
            from .version import VERSION
            report.update(bridge_version=VERSION, connection_configured=config_path().is_file(), owner_issuer_enrolled=trust_path().is_file())
            print(json.dumps(report, indent=2))
            if not report["supported"]:
                raise SystemExit(2)
        elif args.action == "serve":
            from .server import serve
            serve()
        elif args.action == "primary":
            if not args.code:
                raise ValueError("Primary binding requires an existing profile name")
            from .setup import bind_primary
            bind_primary(args.code)
            print("Verified primary profile bound for owner onboarding.")
        elif args.action == "sync-runtime":
            from .setup import sync_runtime
            sync_runtime(native_idle=args.native_idle, source_package=args.source_package)
        elif args.action == "runtime-status":
            import json
            from .host_install import runtime_status
            print(json.dumps(runtime_status(), indent=2))
        elif args.action == "probe":
            from .setup import probe
            probe()
        elif args.action == "enroll":
            if not args.trust_file:
                raise ValueError("Enroll requires --trust-file exported by the owner app installer")
            from .trust import enroll
            enroll(args.trust_file)
            print("Owner app public key enrolled. Restart the bridge once to activate durable login.")
        elif args.action == "setup":
            if not args.bridge_url or not args.app_origin:
                raise ValueError("Setup needs --bridge-url and at least one --app-origin")
            from .setup import configure
            configure(args.bridge_url, args.app_origin, args.port)
        else:
            from .setup import control
            if args.app_origin and len(args.app_origin) != 1:
                raise ValueError("Approve/revoke accepts one --app-origin")
            control(args.action, args.code, args.app_origin[0] if args.app_origin else None, all_browsers=args.all)

    from .runtime import register_runtime
    register_runtime(ctx)

    ctx.register_cli_command("bot-web", "Install and manage your private Hermes web workspace", setup, run)
