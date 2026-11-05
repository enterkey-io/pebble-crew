# Mobile release review failure

The owner reported clipped chat and search controls on cold opening the installed
PWA, an off-centre agent header, undersized icons, different message text sizes,
and unexpected changes to navigation and title labels. The live endpoint reports
0.7.17-preview.1. The owner identified an iPhone 16 Pro Max on current iOS and said
the obstruction appears immediately, before keyboard use.

## What failed

The release retained a fixed outer `.pc-shell` while forcing a standalone
`100vh` canvas. This leaves the document itself with zero height. The emulator
measures the requested shell size, but does not reproduce an installed iPhone's
compositor clipping that fixed root. The same shell owns both chat and navigation,
which explains why both lower surfaces are affected. This is the leading
explanation for the photographed clipping, not a completed physical-device
reproduction. [WebKit reports describe standalone viewport and fixed-element
failures](https://bugs.webkit.org/show_bug.cgi?id=313800). A separate app's
[first-hand investigation](https://github.com/rcarmo/piclaw/blob/main/docs/PWA.md)
also records fixed-root clipping and normal-flow layout on installed iOS.

The mobile header used a left-aligned flex item with a growing space before the
right actions. Its visible contents had no centering constraint. Control hit
areas became 44px while their glyphs stayed at the 16px desktop default.

User text inherited the 16px chat size. Markdown paragraphs and quotes used
Typography's 15px generic UI body style. Tight list items inherited 16px, so
ordinary text varied even inside one agent message. The old test asserted the
Bubble wrapper's 16px value rather than the rendered text.

Mobile branches deliberately omitted the wordmark, moved the account menu to the
header and search to the footer, and replaced row title badges with plain text.
Pinned tiles kept badges. Those changes over-applied the reference instead of
preserving the app's established navigation and shared title presentation.

Review did not catch those visible inconsistencies. The release decision treated
emulated checks as sufficient despite the explicitly unfinished installed-phone
acceptance. Large passing test counts did not establish those missing criteria.

## What the correction changes

- Keep the app root in normal document flow. Retain one viewport/keyboard owner
  and safe-area tokens. Do not add more footer padding or change PWA metadata.
- Center the rendered header group, remove its mobile background oval and size
  the back glyph for navigation. Shared touch glyph sizing accompanies touch
  targets.
- Keep brand and search in the navigation header and account in its footer on
  both layouts. Both PWA edge directions retain the current conversation.
- Use one RoleLabel composition for rows and pins. Allow pinned labels to wrap
  within their available width.
- Make Markdown body text inherit the conversation size for paragraphs, lists,
  quotes and tables. Keep semantic headings and code formatting distinct.

During this repair, a failed build was followed by a browser run using stale
assets. The build command now stops on failure, and ordinary production browser
servers independently reject a build whose input fingerprints differ from source.
Intentional historical archive verification is identified separately.

## Enforcement and evidence

The new browser tests fail the unchanged published web archive for zero document
extent, tiny glyphs, navigation identity and body typography. The reverse-swipe
check initially passed while the conversation was still visible during a closing
transition. It now requires the settled navigation state and exposed destination.

`installed-shell.spec.ts` measures full document extent, centered rendered
header contents, actual glyph sizes, hit-tested control edges, shared labels and
brand/search/account placement. `message-typography.spec.ts` measures real text
nodes for both speakers, Markdown and live replies. The fixed-root source guard
uses the actual released rule as its negative control. Build-proof tests change
an input file and require verification to reject its old output. Unit discovery
now includes unit tests under `test`, as well as package and app tests.

The corrected focused journeys passed 309 unit tests, 13 desktop checks and
50 phone-engine checks. Settled chat, header and light navigation captures were
inspected. The unchanged published archive fails the stronger layout, text and
settled reverse-navigation checks. These prove exercised browser
behavior and structural constraints, not installed-device rendering. The correction
remains unreleased until actual installed-PWA cold-open and keyboard/resume evidence
has been inspected. No owner data, credentials, personas, history or services were
changed during diagnosis.

Evidence stays local under `.audit/pwa-correction` and the task-specific browser
logs. Synthetic screenshots contain no owner conversations. Preserve the old
archive failures and the reviewed candidate captures through subsequent work.
