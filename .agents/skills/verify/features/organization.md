# Organization

## Sub-features

Pins, a flat unsectioned list, optional collapsible sections, whole-row reordering, valid item kinds, Crew chats, scoped settings, hidden/deleted profile reconciliation and menu placement.

## How to get to it (user POV)

Use the rail's New menu, or right-click/press-and-hold a row or pinned tile. Shift+F10 opens the same menu from the keyboard. Move lists include New crew or New section; creation carries the selected pebble. Click a Crew name for chat; its separate chevron expands/collapses members. Drag a Crew as one block, individual pebbles, or section headers. Alt+Arrow moves the focused entity.

Unsectioned pebbles appear below pins with no heading. Move to section → None returns a pebble to that list. A historical collapsed Pebbles destination must not hide it.

## Driving it with Playwright

Find current organization and sidebar specs with `rg --files test/chat-workspace test/mobile`. Run those specs against the matching production configuration. Verify empty built-ins disappear, custom empty sections stay usable, Crews hold Crews, pins are centered and overflow buttons are absent. Run `crew-rail.spec.ts` for whole-Crew drag targets, unchanged membership, collapse persistence, context creation and keyboard menus. `test/mobile/sidebar.spec.ts` exercises touch press-and-hold on rows and pins. Inspect settled desktop, iPhone and Android captures in both themes; the dark rail is darker than the chat, and details share its background.

Run `unsectioned.spec.ts` in both production browser configurations for the historical collapsed list and custom-section round trip.

## Gotchas

The reference entry now imports the production app, but a version match alone does not prove every deployed asset or native runtime copy matches. A 0.00001px browser rounding difference is not a user-visible layout defect. Use a deliberate subpixel tolerance while keeping meaningful overlap/target requirements strict.

## Org chart and reporting

Open Your account → Org chart. The Main Pebble reports to the owner; other
agents may be unattached, with real subtrees beneath them. Hidden agents keep
named cards and remain selectable as managers. Editing a card opens the shared
Profile/Role editor. Returning to chat preserves the draft and reading position.

Run `org-chart.spec.ts` in both production browser configurations. These journeys
edit reporting/Instructions, retain hidden cards and an unsent draft, and verify
there is no management switch even for legacy disabled metadata. Chart checks
assert fixed card dimensions and actual SVG endpoints at the connected cards,
pan/zoom controls, keyboard focus and phone pinch/pan. Inspect the settled desktop, iPhone and Android captures.
Native owner browser acceptance saves a reporting change through the chart and
checks it after reload.

Run `scripts/fixture/workspace_smoke.py` with each pinned native source installed
in its own prepared environment: Python 3.14 for af0cd4df, Python 3.12 for
29112bef. It uses disposable profiles and a deterministic local model to invoke
Main Pebble management and observe an applied receipt without a browser approval.
Unit reporting checks cover always-available Main authority, transfer fencing, legacy-disabled metadata, stale edits, cycles, identity
replacement, migration backup and interrupted-application receipts. Install/update
checks remain model-free; native acceptance is separate and synthetic.
