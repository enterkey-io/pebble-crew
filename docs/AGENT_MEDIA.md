# Agent photos, files and Markdown

In direct Bot Chats, saved assistant messages can display PNG, JPEG and WebP
photos and offer file downloads. Standard Markdown works:

```md
![Project chart](<generated-output-path/chart one.png>)
[Download figures](generated-output-path/figures.csv)
```

Use the real output directory supplied in Pebble Crew's agent context. An agent
can also put `MEDIA:/absolute/path/to/file` on its own line outside a code block.
References become available after the assistant message is saved. Code blocks
remain literal and preserve indentation; tables, task lists, headings, quotes and
nested lists use GitHub-flavored Markdown. Code blocks show their language and
have a copy action.

## Storage and access

The plugin reads the current profile's generated/cache directories on the owner's
host. The preferred directory is `<profile home>/cache/generated`; relative
destinations resolve there. Existing native image/audio/video/document/screenshot
caches are also recognized. Copy intended output there before sharing it if a tool
wrote elsewhere. This does not copy files to Pebble Crew infrastructure.

The browser sends an authenticated session, saved message ID and reference digest.
The native extension independently resolves the actual profile and canonical
Bot Chat, parses the saved assistant message and checks the destination. The
browser cannot request an arbitrary path. Private files, parent traversal,
symlinks, hardlinks and other profiles' directories are rejected.

Files are limited to 10 MiB and read in bounded native chunks. Profile, database,
message and file identity checks reject changes during a transfer. Raster images
are validated completely before receiving an inline image type. Other formats,
including HTML and SVG, are inert downloads. External image links require an
explicit click; the app never loads tracking images automatically.

These are current files, not permanent snapshots. Deleted or changed artifacts
can become unavailable. Files inside an isolated Docker/SSH sandbox must first
be copied to a host-visible generated directory; this feature does not fetch
arbitrary remote sandbox paths. Generated media in Crew/room chats and automatic
video/audio players are separate work.

## Verification

`agent-media.spec.ts` and `markdown.spec.ts` exercise the production browser on
desktop, iPhone WebKit and Android Chromium. They cover downloads, lazy images,
reconnect/reaction stability, reload, safe remote links, retry and narrow-screen
formatting. `startup.spec.ts` verifies selected-chat restoration by stable identity.

`scripts/fixture/media_smoke.py` reads actual saved native assistant media in
disposable default and named profiles, denies private/user-message references,
rejects database replacement between chunks, and asserts zero model turns.
CI runs it on both supported Hermes snapshots. Native-owner browser acceptance
also creates an image and a multi-chunk CSV through the local synthetic model,
displays/downloads them, and reloads the selected chat. These checks establish
the exercised behavior, not every owner's sandbox arrangement.
