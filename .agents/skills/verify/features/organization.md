# Organization

## Sub-features

Pins, whole-row reordering, collapsible sections, valid item kinds, Crew chats, scoped settings, hidden/deleted profile reconciliation and menu placement.

## How to get to it (user POV)

Use the rail's New menu or a row's action menu. Click a Crew to open its chat. Use its action menu for settings. Drag whole rows and section headers, or use Alt+Arrow for keyboard movement.

## Driving it with Playwright

Find current organization and sidebar specs with `rg --files test/chat-workspace test/mobile`. Run those specs against the matching production configuration. Verify empty built-ins disappear, custom empty sections stay usable, Crews hold Crews, pins are centered and the actual action buttons sit at row/tile edges. Check 44px touch targets and settled phone screenshots.

## Gotchas

The reference entry now imports the production app, but a version match alone does not prove every deployed asset or native runtime copy matches. A 0.00001px browser rounding difference is not a user-visible layout defect. Use a deliberate subpixel tolerance while keeping meaningful overlap/target requirements strict.
