"""Produce an agent-readable static page and plain-text guide without JS rendering."""
from pathlib import Path
import html
import json
import re

root = Path(__file__).resolve().parents[1]
source = (root / "docs/AGENT_INSTALL.md").read_text()
release = json.loads((root / 'release.json').read_text())
tags = set(re.findall(
    r'https://github\.com/' + re.escape(release['repository']) + r'/(?:releases/download|blob)/([^/]+)/',
    source,
))
if tags != {release['tag']}:
    raise ValueError('Update AGENT_INSTALL.md links to the release.json tag before building.')
public = root / "apps/web/public"
(public / "install.md").write_text(source)


def inline(text):
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\[([^\]]+)\]\((https://[^)\s]+)\)", r'<a href="\2" rel="noreferrer">\1</a>', text)
    return text


parts, fenced, code = [], False, []
for line in source.splitlines():
    if line.startswith("```"):
        if fenced:
            parts.append("<pre><code>" + html.escape("\n".join(code)) + "</code></pre>")
            code = []
        fenced = not fenced
    elif fenced:
        code.append(line)
    elif line.startswith("#"):
        level = len(line) - len(line.lstrip("#"))
        parts.append(f"<h{level}>" + inline(line[level:].strip()) + f"</h{level}>")
    elif line.startswith("- "):
        parts.append('<p class="bullet">• ' + inline(line[2:]) + '</p>')
    elif re.match(r"\d+\. ", line):
        parts.append('<p class="bullet">' + inline(line) + '</p>')
    elif line.startswith("> "):
        parts.append("<blockquote>" + inline(line[2:]) + "</blockquote>")
    elif line:
        parts.append("<p>" + inline(line) + "</p>")

page = '''<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Install Pebble Crew</title><link rel="stylesheet" href="/install.css"></head><body><header><a href="/">← Back to app</a></header><main><section class="owner-note"><p class="eyebrow">FOR THE OWNER</p><h1>Give this page to your Hermes agent.</h1><p>Your agent installs the plugin on your Hermes host, sets up reliable startup and a private web address, then gives you one private setup link. Open it to create your administrator login and bring in your existing primary agent.</p><p>The plugin includes the web app. Your conversations, memory, service credentials and login stay on your infrastructure. No pairing conversation is needed.</p><a href="/install.md">Read or copy the plain-text instructions ↗</a></section><nav aria-label="Installer downloads"><a href="/downloads/workspace-manifest.json">Package manifest</a><a href="/downloads/workspace-plugin-preview.zip">Complete plugin</a><a href="/downloads/workspace-source-preview.zip">Source code</a></nav><article>'''
page = page.replace('/downloads/', f"https://github.com/{release['repository']}/releases/download/{release['tag']}/")
page += "\n".join(parts)
page += '</article></main><footer>This page contains installation instructions and public software packages. No owner credentials are requested here.</footer></body></html>'
(public / "install.html").write_text(page)
(public / "connection.json").write_text('{"bridgeUrl":null}\n')
(public / "version.json").write_text((root / "release.json").read_text())
