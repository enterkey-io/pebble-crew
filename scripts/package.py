"""Build reviewable positive-allowlist archives. Never include local secrets/state."""
from pathlib import Path
from hashlib import sha256
import json
import shutil
import subprocess
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import os

root = Path(__file__).resolve().parents[1]
release = json.loads((root / "release.json").read_text())
destination = root / "artifacts/packages"
destination.mkdir(parents=True, exist_ok=True)
build = Path(os.environ['WORKSPACE_BUILD_ROOT']).resolve() if os.environ.get('WORKSPACE_BUILD_ROOT') else None
web_root = build / 'web' if build else root / 'apps/web/dist'
owner_bundle = build / 'owner/main.mjs' if build else root / 'apps/owner-node/dist/main.mjs'


def archive(name, files):
    with ZipFile(destination / name, "w", ZIP_DEFLATED) as output:
        seen = set()
        for path, target in sorted(files):
            if not path.is_file() or path.is_symlink() or target in seen:
                raise ValueError('Missing, linked or duplicate release payload entry')
            if Path(target).is_absolute() or '..' in Path(target).parts:
                raise ValueError('Unsafe release archive path')
            seen.add(target)
            info = ZipInfo(target, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = ZIP_DEFLATED
            output.writestr(info, path.read_bytes())


def web_payload():
    allowed = {'index.html', 'avatar-lab.html', '_headers', 'install.html', 'install.md',
               'install.css', 'connection.json', 'version.json', 'manifest.webmanifest',
               'service-worker.js', 'offline.html', 'offline.css'}
    files = [path for path in web_root.rglob('*') if path.is_file() and not path.is_symlink()
            and (str(path.relative_to(web_root)) in allowed or path.relative_to(web_root).parts[0] in {'assets', 'licenses', 'icons'})]
    required = {'manifest.webmanifest', 'service-worker.js', 'offline.html', 'offline.css',
                'icons/pebble.svg', 'icons/pebble-180.png', 'icons/pebble-192.png', 'icons/pebble-512.png'}
    if not required.issubset({str(path.relative_to(web_root)) for path in files}):
        raise ValueError('The web build is missing required PWA assets')
    return files


web = [(path, str(path.relative_to(web_root))) for path in web_payload()]
web += [(root / "scripts/serve-static.mjs", "serve-static.mjs"), (root / "LICENSE", "LICENSE"),
        (root / "docs/SETUP.md", "SETUP.md"), (root / "docs/licenses/shadcn-ui.txt", "licenses/shadcn-ui.txt")]
archive("workspace-web-preview.zip", web)
# Installed-owner Node distribution. Dependencies are installed from the pinned lock;
# runtime state is never packaged. Keep repository-relative paths used by the CLI.
owner = [(path, "apps/web/dist/" + str(path.relative_to(web_root))) for path in web_payload()]
owner.append((owner_bundle, 'apps/owner-node/dist/main.mjs'))
for name in ("apps/owner-worker/migrations/0001_owner.sql",
             "package.json", "package-lock.json", "release.json", "LICENSE", "docs/AGENT_INSTALL.md",
             "scripts/provision-worker.mjs", "docs/licenses/shadcn-ui.txt"):
    owner.append((root / name, name))
for directory in ("apps", "packages"):
    for package in (root / directory).glob("*/package.json"):
        owner.append((package, str(package.relative_to(root))))
for example in (root / "deploy").glob("*.example"):
    owner.append((example, str(example.relative_to(root))))
archive("workspace-owner-preview.zip", owner)

import runpy
payload_paths = runpy.run_path(str(root / "plugins/bot-web/payload.py"))["payload_paths"]
plugin = [(path, "bot-web/" + str(path.relative_to(root / "plugins/bot-web")))
          for path in payload_paths(root / "plugins/bot-web")]
integration = plugin + [(root / 'LICENSE', 'LICENSE'), (root / 'docs/AGENT_INSTALL.md', 'AGENT_INSTALL.md')]
archive('workspace-integration-preview.zip', integration)
# Combined plugin: executable integration plus prebuilt browser/owner runtime.
# Immutable runtime inventory excludes itself, avoiding a checksum cycle.
runtime = [(path, target) for path, target in owner if target not in
           {'docs/AGENT_INSTALL.md', 'scripts/provision-worker.mjs'} and not target.startswith('deploy/')]
runtime_manifest = destination / 'runtime-payload.json'
runtime_manifest.write_text(json.dumps({'schema': 1, 'version': release['bridge_version'],
    'files': {target: sha256(path.read_bytes()).hexdigest() for path, target in sorted(runtime) if path.is_file()}}, indent=2) + '\n')
plugin += [(path, 'bot-web/web-runtime/' + target) for path, target in runtime]
plugin += [(runtime_manifest, 'bot-web/web-runtime/payload.json')]
plugin += [(root / "LICENSE", "LICENSE"), (root / "docs/AGENT_INSTALL.md", "AGENT_INSTALL.md")]
archive("workspace-plugin-preview.zip", plugin)
source = []
# A checkout may contain another task's unpublished drafts. Ship tracked paths only.
tracked = set(subprocess.check_output(
    ['git', 'ls-files', '-z'], cwd=root).decode().split('\0')) if (root / '.git').exists() else None
for directory in ("apps", "packages", "plugins", "scripts", "test", "docs", ".github", "deploy"):
    for path in (root / directory).rglob("*"):
        if (path.is_file() and not path.is_symlink() and not {"dist", "node_modules", "__pycache__", "artifacts", ".wrangler", ".local", ".superdesign"}.intersection(path.parts)
                and path.suffix in {".ts", ".tsx", ".css", ".html", ".md", ".json", ".mjs", ".js", ".webmanifest", ".svg", ".png", ".py", ".yml", ".yaml", ".txt", ".sql", ".jsonc", ".example"}
                and not path.name.startswith(".env") and path.name not in {"auth.json", "credentials.json", "config.yaml"}
                and (tracked is None or str(path.relative_to(root)) in tracked)):
            source.append((path, str(path.relative_to(root))))
for name in ("AGENTS.md", "README.md", "PROGRESS.md", "IMPLEMENTATION_PLAN.md", "WEB_APP_PLAN.md", "LICENSE", "release.json",
             "package.json", "package-lock.json", "tsconfig.json", "eslint.config.mjs", "vitest.config.ts",
             "playwright.config.ts", "playwright.ui-review.config.ts", "vite.ui-lab.config.ts", "playwright.chat.config.ts", "playwright.mobile.config.ts", "playwright.avatar.config.ts", "playwright.owner.config.ts", "vite.client.config.ts", "vite.web.config.ts", ".nvmrc", ".gitignore",
             ".prettierrc.json", ".prettierignore"):
    source.append((root / name, name))
archive("workspace-source-preview.zip", source)
print("Created combined plugin, independent app/integration and source archives in artifacts/packages.")

manifest = {"schema": 1, **release, "artifacts": []}
for name in ("workspace-owner-preview.zip", "workspace-web-preview.zip", "workspace-plugin-preview.zip", "workspace-integration-preview.zip", "workspace-source-preview.zip"):
    data = (destination / name).read_bytes()
    manifest["artifacts"].append({"name": name, "bytes": len(data), "sha256": sha256(data).hexdigest()})
(destination / "workspace-manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")

# A standalone static deployment, with working agent-guide downloads and no Hermes runtime.
site = root / "artifacts/site"
if site.exists():
    shutil.rmtree(site)
site.mkdir()
for path in web_payload():
    target = site / path.relative_to(web_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
shutil.copyfile(root / "scripts/serve-static.mjs", site / "serve-static.mjs")
(site / "downloads").mkdir()
for name in [item["name"] for item in manifest["artifacts"]] + ["workspace-manifest.json"]:
    shutil.copyfile(destination / name, site / "downloads" / name)

# Portable deployment bundle, without recursive inclusion of itself.
archive("workspace-site-preview.zip", [(path, str(path.relative_to(site))) for path in site.rglob("*") if path.is_file()])
checksummed = [item["name"] for item in manifest["artifacts"]] + ["workspace-manifest.json", "workspace-site-preview.zip"]
(destination / "SHA256SUMS").write_text("".join(f"{sha256((destination / name).read_bytes()).hexdigest()}  {name}\n" for name in checksummed))
