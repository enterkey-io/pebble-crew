# Pebble Crew UI standards

This is the current product reference for Pebble Crew's installed web app and
PWA. The [component provenance](UI_COMPONENT_PROVENANCE.md) records where the
building blocks came from. Earlier design plans are historical.

## Active standards

| Area                     | Rule                                                                                                                                                                                                                                                                                                                                                                                                     | Shared implementation                                                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme and controls       | Use one semantic theme across the installed app and review. Use the owned React shadcn controls and Radix behavior for fields, buttons, menus, tabs, and dialogs. Use semantic colors for interaction states. Keep avatar colors independent of the interface theme.                                                                                                                                     | [Theme](../apps/web/src/ui/theme.css), [tokens](../apps/web/src/ui/foundation.css), [controls](../apps/web/src/components/ui)                                                                                                                               |
| Page layout              | Keep the app root in normal document flow. The phone workspace reserves the system safe areas once for every page. Dialogs and sheets apply the same viewport measurements in their own layer. Keep titles, close controls, and the composer reachable at cold open and after the keyboard closes.                                                                                                       | [Workspace panels](../apps/web/src/ui/WorkspacePanels.tsx), [phone layout](../apps/web/src/ui/mobile.css), [viewport](../apps/web/src/ui/viewport.ts), [dialog](../apps/web/src/components/ui/dialog.tsx), [sheet](../apps/web/src/components/ui/sheet.tsx) |
| Sidebar and status       | Keep brand and search in the header and account in the footer. Use the same role label in regular rows and pins. Phone edge swipes return to the retained chat or to the list. Pair the connection dot with visible status text in both themes. The account avatar has no decorative border. When the phone list opens, focus the navigation region and leave keyboard focus indicators on the controls. | [Rail](../apps/web/src/chat/Rail.tsx), [role label](../apps/web/src/ui/RoleLabel.tsx), [edge navigation](../apps/web/src/ui/edge-navigation.ts)                                                                                                             |
| Sections and group chats | Sections organize the sidebar. A group chat has explicitly selected members. Moving a row or adding a shortcut leaves conversation membership and reporting intact. Start a drag from the row itself. Cancel the hold menu if that gesture becomes a drag.                                                                                                                                               | [Organization rail](../apps/web/src/ui/OrganizationRail.tsx), [sections and groups contract](SECTIONS_AND_GROUPS_IMPLEMENTATION.md)                                                                                                                         |
| Editors and dialogs      | Use a shared page header or dialog close control. Keep the header and actions reachable when a form scrolls. Put editor tabs and scroll behavior in the shared editor layout. Use the shared discard confirmation for unsaved changes.                                                                                                                                                                   | [Page header](../apps/web/src/ui/primitives.tsx), [editor layout](../apps/web/src/ui/EditorSurface.tsx), [discard confirmation](../apps/web/src/ui/DiscardChanges.tsx)                                                                                      |
| Chat and approvals       | Use shared Message, Prompt Input, and Confirmation compositions. Keep Send, Stop, and Voice in one action position. When composing, show Send. On a phone, Return inserts a line break. Preserve the draft and reading position through navigation and recovery. Keep pending input reachable and leave a compact receipt when resolved. Explain unavailable conversations without launching setup.      | [Transcript](../apps/web/src/chat/Transcript.tsx), [composer](../apps/web/src/chat/ConversationInput.tsx), [AI Elements](../apps/web/src/components/ai-elements)                                                                                            |
| Pins and photo avatars   | Fit three pinned tiles across the minimum desktop sidebar and a narrow phone. Keep the avatar above its name and shared role label. Show photo avatars as circles at every size and serve a thumbnail from the owner host. Reserve the avatar space while the image loads.                                                                                                                               | [Pinned tile](../apps/web/src/ui/PebbleTile.tsx), [layout](../apps/web/src/ui/layout.css), [avatar delivery](../plugins/bot-web/workspace.py)                                                                                                               |
| Startup                  | Center one animated shape above the progress line, with no role badge. Use the Main Pebble's saved shape and color when available, including for photo avatars. Use the default Iris pebble before setup and while connecting. Sign out belongs in the account menu.                                                                                                                                     | [Startup screen](../apps/web/src/StartupScreen.tsx), [shared avatar](../apps/web/src/AgentAvatar.tsx)                                                                                                                                                       |
| Motion and feedback      | Use the shared timings and respect reduced motion. Keep automatic transcript movement under one controller and yield when the reader scrolls away. Pair meaningful color states with text or another visible cue. Keep button names and focus available to keyboard and touch users.                                                                                                                     | [Theme tokens](../apps/web/src/ui/foundation.css), [transcript controller](../apps/web/src/chat/viewport-motion.ts), [icon button](../apps/web/src/components/ui/icon-button.tsx)                                                                           |

## Open choices

- **Order of the connection dot and label.** The current footer inherits the
  desktop dot-first order. The design decision on order for right-aligned
  statuses is open. Visible status text is an active requirement.

## Recording and reviewing changes

Update the active rule and append a decision in the same pull request whenever
a change introduces, changes, clarifies, or makes an exception to a UI rule.
Record the decision when it is made, even if its implementation follows in
another pull request. Mark a choice as open until it is settled. Cite the
decision ID when implementing a choice already recorded.

For a pull request that touches the web UI and applies an existing rule without
changing the design, add a line to the PR description in this form:

```text
UI unchanged: UI-theme-controls. Replaced a local button with the shared Button and kept its appearance and behavior.
```

The CI check requires a new decision entry or a cited existing rule with a
reason. Reviewers check whether the reason matches the diff. A code change can
affect the interface even if the edited file lives outside the web app. Record
those decisions as well.

Review affected routes in the production build. Inspect settled desktop and
phone screenshots in light and dark themes. Check the affected states,
accessible controls, and the way out of each view. Use the installed iPhone
for changes to the viewport or keyboard. Record emulator and device evidence
separately. See the [verification recipe](../.agents/skills/verify/SKILL.md).

## Decision log

Use an unused `UI-` slug for each entry. Write the rule, why it was chosen, and
what proves it or remains to be checked. Add later decisions as new entries
and name the earlier ID when a rule is superseded.

### UI-theme-controls One theme and one set of shared controls

- Date: 2026-11-05
- Decision: Keep the existing React shadcn and Radix components, one theme, and semantic tokens.
- Why: A separate theme or copied interaction causes screens to drift.
- Evidence: The [provenance record](UI_COMPONENT_PROVENANCE.md) identifies production consumers. The UI checks enforce the shared theme and component use.

### UI-phone-safe-areas The workspace owns phone safe areas

- Date: 2026-11-05
- Decision: Apply the safe areas once in the phone workspace. Shared overlays handle their own viewport bounds.
- Why: Settings and Org chart missed screen-level padding and their close controls fell under the status area.
- Evidence: The [installed-shell tests](../test/mobile/installed-shell.spec.ts) exercise both pages and return to chat. Installed-iPhone confirmation is separate.

### UI-sidebar-layout Keep the sidebar controls and role labels consistent

- Date: 2026-11-05
- Decision: Keep brand and search above the list and account below it. Share role labels between pins and rows. Support both phone edge swipes.
- Why: A different phone layout made controls harder to find and removed the direct way back to a conversation.
- Evidence: The [installed-shell tests](../test/mobile/installed-shell.spec.ts) check the actual controls and labels.

### UI-connection-label Give the connection dot a visible label

- Date: 2026-11-05
- Decision: Show status text beside the connection dot in light and dark themes. Keep the indicator order listed under open choices.
- Why: A lone green dot did not say what was connected.
- Evidence: The [installed-shell tests](../test/mobile/installed-shell.spec.ts) check the connection label in both themes.

### UI-sections-and-groups Separate organization from group chat membership

- Date: 2026-11-05
- Decision: Use sections for placement and explicit participants for group chats. Give a drag priority over the hold menu.
- Why: Moving a row should not change who receives a group message. Holding a row should not leave a menu open during a drag.
- Evidence: The [sections and groups contract](SECTIONS_AND_GROUPS_IMPLEMENTATION.md) records migration and native verification.

### UI-editor-layout Share editor navigation and close behavior

- Date: 2026-11-05
- Decision: Use the common editor layout, dialog sizes, and discard confirmation.
- Why: Per-screen close and scroll rules made editors inconsistent and could make exit controls unreachable.
- Evidence: The [installed-shell tests](../test/mobile/installed-shell.spec.ts) verify the pebble editor close control. The UI checks enforce reuse.

### UI-chat-controls Keep chat controls and reading position stable

- Date: 2026-11-05
- Decision: Use one composer action position and shared message and approval patterns. Preserve drafts and reading position through chat transitions.
- Why: Moving controls and message rows interrupted typing and made live replies hard to follow.
- Evidence: The [verification feature map](../.agents/skills/verify/features/README.md) lists the production chat, request, and recovery journeys.

### UI-account-avatar-focus Keep the sidebar avatar borderless

- Date: 2026-11-05
- Decision: Open the phone sidebar with focus on the navigation region. Show the shared focus ring on the account control only when keyboard focus reaches it.
- Why: Focusing the avatar during navigation drew a ring that looked like a border and made the footer appear selected.
- Evidence: The [phone navigation tests](../test/mobile/navigation-page.spec.ts) check the initial avatar and keyboard focus after the account menu closes in both themes. Chromium also checks Tab order.

### UI-startup-pebble Keep the loading screen focused on progress

- Date: 2026-11-05
- Decision: Center one animated pebble above the progress line. Use the Main Pebble's saved shape when available. Keep Sign out in the account menu.
- Why: Startup needs one clear status and a recognizable avatar. The loader can show the saved shape without requesting a photo or exposing it before sign-in.
- Evidence: The [startup journeys](../test/chat-workspace/startup.spec.ts) check both loading phases, avatar motion, progress placement, and restored chat.

### UI-startup-no-role-badge Show only the animated shape on the loading screen

- Date: 2026-11-05
- Decision: Keep the Main Pebble star in the workspace. The loading screen shows the animated shape alone in both loading phases. Until a Main Pebble is available, use the default Iris pebble.
- Why: The shape makes the loader recognizable. The star denotes a role in the workspace and adds detail with no purpose on the loading screen.
- Evidence: The [startup journeys](../test/chat-workspace/startup.spec.ts) check the Iris fallback, the saved shape without a badge, and the star on the pinned Main Pebble after loading.

### UI-compact-pins-circle-photos Fit three pins and display circular photo avatars

- Date: 2026-11-05
- Decision: Fit three pins at the minimum sidebar width. Keep the larger pin avatar and title label in a compact tile. Center-crop photo avatars into circles and serve a 256 px thumbnail from the owner host. Show no substitute avatar while a photo loads. Share concurrent requests for the same photo.
- Why: Pinning a third pebble should leave room for the conversation. A shared circular crop keeps photos consistent across sizes, and the thumbnail avoids sending the native original to the browser.
- Evidence: The [browser checks](../test/chat-workspace/interface-preferences.spec.ts) verify narrow pin layout, circular crops, and a single photo request without a placeholder. The [native acceptance](../scripts/fixture/management_smoke.py) verifies thumbnail size and confirms the saved original is preserved.

### UI-missing-bot-chat Explain why an existing pebble’s chat cannot open

- Date: 2026-11-05
- Decision: When a managed Hermes profile has no active Bot Chat, name the pebble in a compact error dialog. Keep the current conversation and its draft. Open New pebble only from an explicit setup action.
- Why: A profile can be present in the sidebar before its native conversation is available. Opening the creation form obscures the cause and makes an existing pebble look like a new one.
- Evidence: The [browser journeys](../test/chat-workspace/setup-continuity.spec.ts) check a missing chat in the roster and a stale roster after Hermes loses the canonical chat. The [bridge boundary test](../test/plugin/test_security.py) verifies that opening a missing chat performs no runtime preparation.
