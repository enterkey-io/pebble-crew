# Pebble Crew UI standards

This is the current product reference for Pebble Crew's installed web app and
PWA. The [component provenance](UI_COMPONENT_PROVENANCE.md) records where the
building blocks came from. Earlier design plans are historical.

## Active standards

| Area                     | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Shared implementation                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme and controls       | Use one semantic theme across the installed app and review. Use the owned React shadcn controls and Radix behavior for fields, buttons, menus, tabs, and dialogs. Use semantic colors for interaction states. Keep avatar colors independent of the interface theme.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [Theme](../apps/web/src/ui/theme.css), [tokens](../apps/web/src/ui/foundation.css), [controls](../apps/web/src/components/ui)                                                                                                                               |
| Page layout              | Keep the app root in normal document flow. The phone workspace reserves the system safe areas once for every page. Dialogs and sheets apply the same viewport measurements in their own layer. Keep titles, close controls, and the composer reachable at cold open and after the keyboard closes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [Workspace panels](../apps/web/src/ui/WorkspacePanels.tsx), [phone layout](../apps/web/src/ui/mobile.css), [viewport](../apps/web/src/ui/viewport.ts), [dialog](../apps/web/src/components/ui/dialog.tsx), [sheet](../apps/web/src/components/ui/sheet.tsx) |
| Sidebar and status       | Keep brand and search in the header and account in the footer. Use the same role label in regular rows and pins. Phone edge swipes return to the retained chat or to the list. Pair the connection dot with visible status text in both themes. The account avatar has no decorative border. When the phone list opens, focus the navigation region and leave keyboard focus indicators on the controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [Rail](../apps/web/src/chat/Rail.tsx), [role label](../apps/web/src/ui/RoleLabel.tsx), [edge navigation](../apps/web/src/ui/edge-navigation.ts)                                                                                                             |
| Sections and group chats | Sections organize the sidebar. Reordering a section opens a moving gap between sections; it never highlights a section as a container. Save on drop and restore spacing on cancel. A group chat has explicitly selected members. Moving a row or adding a shortcut leaves conversation membership and reporting intact. Tap to open. Press and hold in place to show options. Move to start a drag from the row itself. Confirm before deleting a group chat. Show the group portrait’s +N count in the shared neutral inverse Badge with bold text at least 12px.                                                                                                                                                                                                                                                                                                                                                      | [Organization rail](../apps/web/src/ui/OrganizationRail.tsx), [sections and groups contract](SECTIONS_AND_GROUPS_IMPLEMENTATION.md)                                                                                                                         |
| Editors and dialogs      | Use a shared page header or dialog close control. Keep the header and actions reachable when a form scrolls. Put editor tabs and scroll behavior in the shared editor layout. Use the shared discard confirmation for unsaved changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [Page header](../apps/web/src/ui/primitives.tsx), [editor layout](../apps/web/src/ui/EditorSurface.tsx), [discard confirmation](../apps/web/src/ui/DiscardChanges.tsx)                                                                                      |
| Chat and approvals       | Use shared Message, Prompt Input, and Confirmation compositions. Keep Send, Stop, and Voice in one action position. Center the controls in a one-line composer and keep their height from the bottom edge fixed as the draft grows. Use a quiet camera icon beside it for video calls. When composing, show Send. On a phone, Return inserts a line break. Preserve the draft and reading position through navigation and recovery. Follow new replies at the bottom and keep a scrolled-up reader in place. Remove the temporary bubble if a send fails or remains unconfirmed. Keep the draft and show the delivery state. Keep pending input reachable and leave a compact receipt when resolved. Explain unavailable conversations without launching setup. Chat photos and stack cards show server-made smaller copies; the viewer loads only the open photo’s original. A stack card takes its top photo’s shape. | [Transcript](../apps/web/src/chat/Transcript.tsx), [composer](../apps/web/src/chat/ConversationInput.tsx), [AI Elements](../apps/web/src/components/ai-elements)                                                                                            |
| Pins and photo avatars   | Give pin tiles a 100 px minimum and wrap when space runs out. Keep the same filled, single-line role labels as the roster. Show circular photo thumbnails from the owner host, reserve their space on startup, and reuse loaded photos when a section reopens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [Pinned tile](../apps/web/src/ui/PebbleTile.tsx), [layout](../apps/web/src/ui/layout.css), [avatar delivery](../plugins/bot-web/workspace.py)                                                                                                               |
| Avatar badges            | Use one badge: gold for needs attention, blue for unread, green for active work; otherwise only the Main star when applicable. Idle has no dot; gray is not a status. Sidebar rows use the avatar badge. Share its position and diameter across states. Photo frames are square circles; the badge center lies on the lower-right circumference. Live pins, header and details share the same activity state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [Avatar](../apps/web/src/AgentAvatar.tsx), [status dot](../apps/web/src/ui/StatusDot.tsx), [layout](../apps/web/src/ui/layout.css)                                                                                                                          |
| Message mentions         | Resolve known public handles, native profile aliases and unambiguous local roster aliases to stable identities in direct and group messages. Use neutral inline controls with a visible underline, keyboard focus and a read-only profile popover. Preserve the original token and copy text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [Mention rendering](../apps/web/src/chat/MessageMention.tsx), [identity lookup](../apps/web/src/chat/mentions.ts)                                                                                                                                           |
| Startup                  | Reserve an empty loading space until the Main Pebble's saved shape/color are known, then fade in its unbadged greeting with glances, blinks and a gentle hop. Use no fallback avatar or progress line. Respect reduced motion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [Startup screen](../apps/web/src/StartupScreen.tsx), [shared avatar](../apps/web/src/AgentAvatar.tsx)                                                                                                                                                       |
| Motion and feedback      | Use the shared timings and respect reduced motion. Keep automatic transcript movement under one controller and yield when the reader scrolls away. Pair meaningful color states with text or another visible cue. Keep button names and focus available to keyboard and touch users.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [Theme tokens](../apps/web/src/ui/foundation.css), [transcript controller](../apps/web/src/chat/viewport-motion.ts), [icon button](../apps/web/src/components/ui/icon-button.tsx)                                                                           |

Chat bubbles offer Pebble color and Neutral in General settings. Neutral uses the
current theme’s muted surface and foreground. The device remembers the choice.

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

While text is present in the composer, hide the video-call icon and give that
space to the message field. Restore it when the text is cleared. Loading starts
with an empty avatar space, then fades in the Main Pebble's saved shape and color.
That shape is the visual loading indicator: it glances, blinks and gently hops;
there is no default-purple swap or progress line. Reduced motion stays static.

Each avatar has one badge slot. Show gold for attention, blue for unread, or green
for active work; otherwise show the Main Pebble star when applicable. Never add a separate gray
photo-status dot. Photos use a square circular frame; every badge is centered
halfway across its lower-right circumference. Pins, chat headers and other
photo-avatar contexts use the same anchor.

Unread navigation uses compact blue buttons at the top and bottom of the sidebar list
when unread chats are outside the visible area. A button scrolls to the nearest
unread chat in that direction without opening it or marking it read. A visible
pin or shortcut represents the same chat. Collapsed sections retain an unread
dot on their heading. Keep the brand, account footer and iOS page scrolling intact.

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
- Decision: Keep brand and search above the list and account below it. Share role labels between pins and rows. Support both installed phone edge swipes. Keep normal scrolling and row taps available outside the outer gesture gutter.
- Why: A different phone layout made controls harder to find and removed the direct way back to a conversation.
- Evidence: The [installed-shell tests](../test/mobile/installed-shell.spec.ts) check the actual controls and labels. The [gesture tests](../test/mobile/composition-and-gesture.spec.ts) also send browser touch input in both directions.

### UI-docked-sidebar-footer Keep account settings available while the list scrolls

- Date: 2026-11-05
- Decision: Keep the header and account footer outside the scrollable list. Fill the available sidebar height on desktop and respect the app safe areas on phones.
- Why: The desktop resizable panel could scroll the entire sidebar and leave the account controls below the visible window.
- Evidence: The [sidebar browser checks](../test/chat-workspace/interface-preferences.spec.ts) scroll a long roster in a short viewport and open Settings from the stationary footer.

### UI-installed-sidebar-scroll-to-top Use native status-bar scrolling in the installed iOS sidebar

- Date: 2026-11-05
- Decision: Let the document own vertical scrolling while the standalone iOS sidebar is open. Dock the header and account footer inside the safe areas. Preserve the sidebar offset when returning to chat and keep the transcript's own scroll position.
- Why: [WebKit disables native scroll-to-top on nested scroll views](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/RemoteLayerTree/ios/ScrollingTreeScrollingNodeDelegateIOS.mm#L359-L365).
- Evidence: The [installed-shell browser test](../test/mobile/installed-shell.spec.ts) verifies the document offset, docked controls, and retained draft. Confirm the status-bar tap on an installed iPhone before release.

### UI-sidebar-navigation Keep area switching and reordering in the sidebar

- Date: 2026-11-05
- Decision: Chat and Tasks switch the contents of the open phone sidebar. Open the conversation or board after selection. Sort active conversations by recency within their own section. Pins use the saved order and preview displacement during manual drag. Persist only on drop.
- Why: Area switching should leave the next selection in reach. Recency should never change a deliberate pin order.
- Evidence: [Sidebar order](../test/chat-workspace/sidebar-order.spec.ts) and [area switching](../test/chat-workspace/work.spec.ts) browser checks.

### UI-sent-image-preview Open sent images inside the conversation

- Date: 2026-11-05
- Decision: Use the same inline image and zoom viewer for supported sent image attachments and agent-shared images. Keep the conversation and its draft when closing the viewer.
- Why: A generic download can take an installed web app away from the conversation.
- Evidence: The [attachment browser check](../test/chat-workspace/agent-media.spec.ts) pastes and sends an image, opens it in chat, and verifies the same composer remains after close.

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

### UI-pin-reflow Keep pinned roles readable when the sidebar narrows

- Date: 2026-11-05
- Decision: Reserve at least 100 px per pin and wrap as space narrows. Keep the avatar above the name and use the same filled role label as the roster. Use one line and an ellipsis for long roles, with the full role in the tile’s accessible name and Pebble details. Keep at least [4.5:1 text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) at rest, on hover and when selected. Hover changes the tile surface and preserves the selected fill.
- Why: Forcing three pins at every width cramped titles and made the light-theme tag compete with the hover surface. This supersedes the three-pins-at-minimum-width rule in UI-compact-pins-circle-photos.
- Evidence: The [browser checks](../test/chat-workspace/interface-preferences.spec.ts) verify tile wrapping at narrow widths, aligned labels for three pins, and contrast in both themes.

### UI-pin-photo-badge Center status badges on the photo edge

- Date: 2026-11-05
- Decision: Place the center of the Main Pebble star and unread dot on the lower-right circumference of a pinned photo. Use the same anchor for both so the unread dot replaces the star in place. In a chat header, center the activity dot on the lower-left edge of the photo and separate it with a 1 px border.
- Why: A circular crop and its rectangular layout box have different edges.
- Evidence: The [unread browser checks](../test/chat-workspace/unread.spec.ts) measure each badge center against the displayed photo radius in both themes.

### UI-conversation-opening Show the requested identity while a conversation opens

- Date: 2026-11-05
- Decision: Show the requested agent name and the shared loading line during an explicit conversation switch. Hide the previous transcript and composer until the requested conversation can accept input. Preserve the previous draft and restore the previous view on a failed switch.
- Why: A visible read-only composer for the previous agent invites a tap that cannot open the iOS keyboard.
- Evidence: The [held-open browser test](../test/chat-workspace/composition-integrity.spec.ts) delays the requested agent and checks its identity, the loading line, and the absence of a composer.

### UI-missing-bot-chat Explain why an existing pebble’s chat cannot open

- Date: 2026-11-05
- Decision: When a managed Hermes profile has no active Bot Chat, name the pebble in a compact error dialog. Keep the current conversation and its draft. Open New pebble only from an explicit setup action.
- Why: A profile can be present in the sidebar before its native conversation is available. Opening the creation form obscures the cause and makes an existing pebble look like a new one.
- Evidence: The [browser journeys](../test/chat-workspace/setup-continuity.spec.ts) check a missing chat in the roster and a stale roster after Hermes loses the canonical chat. The [bridge boundary test](../test/plugin/test_security.py) verifies that opening a missing chat performs no runtime preparation.

### UI-section-avatar-reopen Reuse loaded avatars when reopening a section

- Date: 2026-11-05
- Decision: Paint loaded avatars when section rows return. Keep a bounded cache of successful photo thumbnails in the current app session. A new appearance revision fetches the updated photo.
- Why: Closing a section removes its rows from view. Reopening it should show familiar avatars immediately.
- Evidence: The [sidebar browser checks](../test/chat-workspace/interface-preferences.spec.ts) reopen a section and verify that its photos appear with a single request per profile.

### UI-voice-call-history Show completed calls in the conversation

- Date: 2026-11-05
- Decision: Use a compact trace row with a phone icon, “Voice call ended” and the local end time. Place it between messages by time. Keep it visible after reloading, independent of the optional follow-up. Voice previews produce no entry.
- Why: A call is useful conversation history even if neither side spoke or the agent sends no follow-up.
- Evidence: The [voice browser journeys](../test/chat-workspace/voice.spec.ts) verify receipt placement, reload persistence and a real loopback call ending without captions.

### UI-message-mentions Identify people within message text

- Date: 2026-11-05
- Decision: Give known mentions a neutral inline background and dotted underline. Open a read-only profile popover with the current public handle. Resolve only unambiguous enrolled identities supported by workspace profiles or local room rosters. Preserve original token spelling in history and clipboard text.
- Why: Plaintext mentions were indistinguishable from prose after public handles changed. Reading a profile must leave chat, drafts and agent execution alone.
- Evidence: The message-rendering unit checks cover code, links, emails and unknown tokens. Added production mention journeys for direct and group messages, keyboard activation, clipboard preservation, both themes and phone layouts using synthetic identities. Browser execution and settled screenshot review remain pending because the sandbox blocks loopback listeners.

### UI-cold-avatar-batches Load sidebar photos without a per-photo roster scan

- Date: 2026-11-05
- Decision: Batch visible photos after the roster resolves. Use stable Pebble identities and recheck native incarnation before returning a 256 px thumbnail. Keep the reserved avatar space during loading.
- Why: A cold app load otherwise queues many redundant roster scans and makes photos appear one at a time.
- Evidence: The [browser check](../test/chat-workspace/interface-preferences.spec.ts) loads 35 photos twice with bounded batches. The [owner journey](../test/owner-browser/owner.spec.ts) verifies the real plugin returns a saved native photo through the batch route.

### UI-nested-pebble-editor Return to the Pebble details panel after editing

- Date: 2026-11-05
- Decision: Keep the details panel in phone navigation history when its Edit Pebble dialog opens. Close and browser Back dismiss the editor first.
- Why: Returning directly to chat skips the panel the user opened the editor from.
- Evidence: The [installed-shell browser checks](../test/mobile/installed-shell.spec.ts) exercise both dismissals and a second Back from the details panel to chat.

### UI-chat-open-focus Open chats without a Back focus ring

- Date: 2026-11-05
- Decision: Move focus to the chat heading when leaving the phone list for a chat. Restore Back focus after keyboard Escape.
- Why: A focus ring on Back after selecting a chat looked like a stuck control.
- Evidence: The [installed-shell checks](../test/mobile/installed-shell.spec.ts) distinguish touch selection from keyboard dismissal.

### UI-voice-picker Keep voice choices inside the safe area

- Date: 2026-11-05
- Decision: Anchor the voice list to its trigger, constrain it to the safe editor bounds, and scroll the list independently.
- Why: Centering the menu around a selected item could position a long voice list above the phone’s visible area.
- Evidence: The [voice browser checks](../test/chat-workspace/voice.spec.ts) open and scroll a long list on a short installed viewport.

### UI-voice-provider Keep provider setup in the Pebble Voice tab

- Date: 2026-11-05
- Decision: Use the shared segmented control for provider selection, the private Secret Card for keys, and the same voice selector, preview and call bar for both providers.
- Why: A Pebble has one place to set up or change its voice. Voice previews play a sample without activating the microphone.
- Evidence: The [ElevenLabs voice browser journey](../test/chat-workspace/eleven-voice.spec.ts) exercises provider selection, the saved voice catalog, preview, interruption and the call receipt.

### UI-image-download-contrast Keep image actions legible on every message

- Date: 2026-11-05
- Decision: Use the shared secondary button colors for image downloads and the accent surface on hover. The glyph has its own foreground in every state.
- Why: A download icon could inherit the outgoing message’s dark text while sitting on a dark overlay.
- Evidence: The [pasted-image browser checks](../test/chat-workspace/agent-media.spec.ts) measure the icon against its surface in both themes, including hover and focus.

### UI-sidebar-hold-options Keep a stationary hold distinct from drag

- Date: 2026-11-05
- Decision: On touch, a stationary hold opens the shared options menu, including with slight finger movement. A moving drag cancels the menu. Delete group uses a confirmation and the native Hermes operation.
- Why: A phone could start a drag during a stationary hold, leaving no way to reach actions.
- Evidence: The [phone sidebar checks](../test/mobile/sidebar.spec.ts) cover pebbles, pins, groups, sections and a moving drag. The [owner browser check](../test/owner-browser/owner.spec.ts) exercises native group deletion and reload.

### UI-chat-model-picker Open a provider-first model picker from chat

- Date: 2026-11-06
- Decision: Submitting bare `/model` opens a searchable provider list. Selecting a provider shows its models. The header keeps the current session model visible on both levels. An explicitly typed model still goes through Hermes.
- Why: Users need to see the current model and browse choices without learning command syntax or scanning a combined list.
- Evidence: The [slash-command browser journey](../test/chat-workspace/commands.spec.ts) checks both levels, the current model, the native confirmation, and the absence of a chat prompt.

### UI-shared-chat-markdown Render Markdown in both sides of chat

- Date: 2026-11-06
- Decision: Use the same Markdown renderer for owner and Pebble bubbles. Keep owner paragraph line breaks and raw copy. Preserve literal code, escaped mentions and attachment permissions.
- Why: Owner bubbles were using a separate plaintext renderer and showing the underscore markers.
- Evidence: The [Markdown browser journey](../test/chat-workspace/markdown.spec.ts) checks rendered emphasis, bold, code, lists and tables.

### UI-video-self-view Share camera only while it is on

- Date: 2026-11-06
- Decision: Fit the call frame to the avatar stream and keep chat and approvals reachable. Camera starts off. Turning it on shares video with Atmee and shows the mirrored preview inside the lower-right corner. Turning it off stops the local track and removes it from the room. When the browser blocks incoming sound, show Enable sound below the call controls.
- Why: Camera sharing is explicit, and the user can restore sound in the call.
- Evidence: The [video browser journey](../test/chat-workspace/atmee.spec.ts) verifies audio playback, portrait and landscape framing, opt-in publication, and camera teardown.

### UI-video-composer Open video calls from chat

- Date: 2026-11-06
- Decision: Put an unfilled camera icon with a 44 px touch target beside the composer’s primary action in individual chats. Settings only selects the avatar and explains that a call shares a few recent messages with Atmee.
- Why: The owner starts video where they are already talking to the Pebble. Recent context is automatic.
- Evidence: The [video browser journey](../test/chat-workspace/atmee.spec.ts) checks placement, touch size, the setup fallback, and delivery to the avatar.

### UI-atmee-character-creation Review the character before sending it

- Date: 2026-11-06
- Decision: Open a compact inline form in Voice → Video with a portrait, a voice style, and an editable name and description. Use shared fields and one explicit creation action. Explain the provider transfer and possible credit use beside that action.
- Why: The owner can build a character from their existing Pebble without uploading a recording or handing over a full profile.
- Evidence: The [browser journey](../test/chat-workspace/atmee.spec.ts) checks the prefill, reviewed payload, asynchronous status, and character selection.

### UI-owner-login-error Show sign-in errors in the form

- Date: 2026-11-06
- Decision: Put the shared destructive Alert beside the sign-in action and associate it with the password field. Use one message for an incorrect username or password and leave the form available for retry.
- Why: A rejected sign-in needs to explain the failure while preserving the user's next attempt.
- Evidence: The [sign-in journey](../test/chat-workspace/owner-login.spec.ts) checks the actual rejection shape, alert placement, and retry control on desktop and phone.

### UI-sidebar-resize Let the panel own the sidebar width

- Date: 2026-11-06
- Decision: The resizable panel owns the sidebar width at every desktop breakpoint. Its content fills the panel. Keep a thin divider with a wider pointer target and keyboard resizing.
- Why: A fixed-width child can hide the effect of a working resize handle.
- Evidence: The [sidebar journey](../test/chat-workspace/interface-preferences.spec.ts) drags the visible rail at 1,100px and checks saved width and keyboard resizing.

### Voice provider setup feedback

- Decision: Show all available ElevenLabs voices in the voice picker, with a retryable catalog error next to the field. Use the same private Atmee key card in Connections and a Pebble’s Video settings.
- Why: A provider request can fail independently of a saved selection. Key errors need to be visible where the owner enters the key, and a confirmed save should immediately unlock the character controls.
- Evidence: The ElevenLabs browser journey retries a catalog failure and selects a returned voice and plays its recorded sample without a call. Atmee browser and native owner journeys exercise a rejected key, a confirmed save, and character selection.

### Atmee video avatar setup

- Decision: Use a portrait picker, a voice choice with playable samples, and a separate review of the profile prepared from Hermes.
- Why: Choosing a portrait should look like choosing media. The owner should hear and select a voice before creating an avatar, and see which profile text Atmee receives.
- Evidence: The desktop and phone avatar journey selects the second sample and requires profile review. The native owner journey reads an isolated SOUL file, then creates and selects the avatar using the chosen sample.

### Atmee avatar requirements and voice recovery

- Decision: Explain the outstanding step next to Create video avatar. Show the provider’s safe reason when voice design fails and offer a recording as a separate voice source.
- Why: A photo and a voice description do not provide the audio Atmee needs for a video avatar. A provider outage should leave a usable way to finish the form.
- Evidence: Browser and plugin tests cover failed design, selecting a recording, reviewing the profile, and submitting through the upload route.

### UI-chat-bubble-colors Chat bubble color preference

- Date: 2026-11-06
- Decision: General settings offers Pebble color and Neutral for chat bubbles. Pebble color is the default. Neutral uses the current theme’s muted surface and foreground. Store this choice and Appearance in the owner's Hermes presentation settings. Cache the last choice in the browser for startup. Import an explicit local choice only when the corresponding shared field is unset. System resolves to each device’s light or dark mode. Keep panel widths, panel state, drafts and last-opened chats local. Use the existing Item and Select controls.
- Why: The owner can choose agent colors or a neutral conversation surface that follows light, dark and system appearance.
- Evidence: The interface preference browser journey checks both themes, reload persistence, startup application and updates across isolated browser profiles on desktop, iPhone and Android layouts.

### UI-sidebar-unread-navigation Surface unread chats outside the visible list

- Date: 2026-11-07
- Decision: Show blue unread jump buttons at the list edges, using the shared Button. Scroll to the nearest unread chat or collapsed section, respect reduced motion and deduplicate visible chat placements.
- Why: A blue row dot is not discoverable after it scrolls outside the sidebar. Jumping to it preserves the current conversation and read state.
- Evidence: Production browser checks cover desktop, iPhone, Android, both themes, live unread changes and installed-page scrolling. Physical iPhone behavior remains separate from browser emulation.

### UI-composer-video-space Give typing priority over starting a video call

- Date: 2026-11-07
- Decision: Hide the video-call icon while the message field contains text, including restored drafts. Restore it on clearing or sending. Keep the send action in its existing position.
- Why: Typing needs the available composer width; the video control is useful when the field is empty.
- Evidence: The [composer video journey](../test/chat-workspace/composer-video.spec.ts) checks field width, restored drafts, clearing, sending and phone newlines.

### UI-startup-welcome Wait for the real Main Pebble and animate its greeting

- Date: 2026-11-07
- Decision: Supersede the fallback and progress-line portions of UI-startup-pebble and UI-startup-no-role-badge. Keep the loading space empty until the saved Main Pebble shape/color are known, then fade it in without a role badge. Use a loading-only greeting with side glances, blinks and a gentle hop instead of a progress line. Respect reduced motion and the existing background/offscreen scheduler suspension.
- Why: Swapping a default purple shape for a personal one looks unfinished. The personal animation can communicate loading without a second indicator.
- Evidence: The [startup journeys](../test/chat-workspace/startup.spec.ts) hold authentication, connection and chat opening separately, verify no placeholder or progress line, check the saved appearance, fade and reduced motion, then restore the conversation. The portable pose tests verify both gaze directions, blinking and bounded hops.

### UI-agent-name-accents Preserve names and fold only search comparisons

- Date: 2026-11-07
- Decision: Show native display names verbatim in the existing-agent picker. Search compares both names and internal profile IDs without accents or case differences; never rewrite a label or ID for matching.
- Why: Names such as Öykü should retain their spelling while remaining easy to find on any keyboard.
- Evidence: The [agent-name search journey](../test/chat-workspace/agent-name-search.spec.ts) searches an opaque profile ID by accented, unaccented, uppercase and decomposed name variants and verifies the setup Name field.

### UI-chat-photo-badge-anchor Center the Main badge on the photo edge

- Date: 2026-11-07
- Decision: Share the pinned-photo edge rule with the Main badge in the chat header. Its center lies on the lower-right circumference, matching the active indicator's lower-left geometry. Use the chat background around the header badge.
- Why: The old header inherited a shape-avatar inset, placing the Main badge over the photo while the active dot already used the correct circular anchor.
- Evidence: The [unread/photo badge journey](../test/chat-workspace/unread.spec.ts) checks both centers against the actual photo radius, their alignment and separation, and the idle header on desktop, iPhone and Android in both themes. The added assertion fails against preview.16.

### UI-single-avatar-badge One badge slot for role, work and unread state

- Date: 2026-11-07
- Decision: Supersede the simultaneous role/activity badges in UI-chat-photo-badge-anchor. Every avatar has at most one badge: unread blue pulse first, then a blue working pulse for thinking/working turns, otherwise the Main Pebble star. Use the same lower-right slot for both photo and shape avatars. Photos own a square aspect ratio and share the exact circular edge anchor in every context. Each context sets one badge diameter for all states so changing between a star and pulse does not resize or shift the badge. The live details avatar receives the same activity state as the chat header and pins. Remove the legacy gray photo dot and its styles.
- Why: Independent photo-status rendering produced an extra gray dot alongside the existing star or blue pulse. One shared component and one mutually exclusive badge choice prevent stacked indicators.
- Evidence: The [photo badge journey](../test/chat-workspace/unread.spec.ts) verifies one badge in the header and pin during work, blue pulse semantics, no gray dot, restored idle star and photo-edge geometry in both themes on desktop and phones. Sidebar unread navigation still uses the actual unread state, so a working pulse alone does not create an unread jump.

### UI-section-collapse-motion Keep section headings still while contents collapse

- Date: 2026-11-07
- Decision: Animate section contents by height and section rearrangement by position only. Contain child margins with a flow-root section so removing the closed body does not change the heading's layout at the final frame.
- Why: Size projection on the entire section and a collapsing final-child margin caused a small heading jump when the body disappeared.
- Evidence: The [section motion journey](../test/chat-workspace/section-motion.spec.ts) samples rendered label position and height through closing, then uses rapid pointer/touch toggles and opens a chat. It reproduces a heading movement on preview.17. The reported one-off Hermes disconnect remains unconfirmed; no connection fix is claimed from a fixture test.

### UI-group-count-bubble Make additional group members readable

- Date: 2026-11-07
- Decision: Use the shared Badge for the group portrait's +N count, with bold text at least 12px, at least 20px height and the neutral primary/primary-foreground theme pair. It is a light bubble with dark text in dark mode and the inverse in light mode. Keep the full member total in the portrait's accessible label.
- Why: Thin 9px muted text disappeared into overlapping avatars.
- Evidence: The [group count journey](../test/chat-workspace/group-count.spec.ts) checks 12 members render +7, actual bold type, minimum size and contrast above 7:1 in both themes on desktop and phones, with settled screenshots.

### UI-sidebar-preview Readable message summaries

- Date: 2026-11-07
- Decision: Use one bounded, cached Markdown-to-text projection for agent and group bylines. Keep readable prose, link labels and accents; remove formatting controls and link destinations. Summarize code/script blocks as “Code snippet” and photos as “Photo”. Never mount Markdown or HTML in a sidebar row. Preserve full message content in chat.
- Why: A one-line navigation preview should help identify a conversation without exposing raw formatting or a wall of code.
- Evidence: Parser tests cover headings, emphasis, lists, tables, inline code, fenced code, scripts, links and shared photos. The sidebar preview journey checks the production rows on desktop and phones in both themes.

### UI-shared-app-title Owner-local sidebar title

- Date: 2026-11-07
- Decision: General settings has one App title field and Save action using the shared Input, Label, Button and Item. Store it in Hermes presentation settings, with its own revision, and include it in the normal workspace snapshot. Update the sidebar wordmark across devices without changing the product name elsewhere. Default to Pebble Crew. Preserve dirty text when another device changes the saved title, and constrain long wordmarks so header actions keep their space.
- Why: A custom title belongs to this installation, with independently editable fields for appearance and chat bubbles, separate from agent profiles and pin ordering.
- Evidence: Native presentation checks cover persistence, idempotent receipts, stale revisions, input bounds and no profile writes. Desktop/phone journeys cover saving, reloading, another device and retained unsaved text.

### UI-avatar-status-colors One semantic status circle everywhere

- Date: 2026-11-07
- Decision: Supersede the working-blue rule in UI-single-avatar-badge. Gold means input is needed, blue means unread messages, and green means active work. Idle pebbles have no status dot; the Main star may occupy the idle slot. Never show a gray status. Resolve one badge per avatar in this order: attention, unread, active, Main role. Compute one presence per agent for the sidebar, chat header and details. In the open chat, show active work ahead of unread until the reply settles. Keep the underlying unread state for later display. Sidebar rows use the avatar badge, including shortcuts; no separate far-right message dot. Native shape decoration cannot add another attention/done badge. A gold sidebar jump reveals an offscreen pending approval, with the same interaction as unread navigation. Collapse headings retain pending indicators for their hidden children. Gold takes precedence when both jump types share an edge. Use one observer/scheduled measurement for both signals.
- Why: Status needs the same meaning, anchor and priority wherever a pebble appears. Pending decisions must remain discoverable even when their conversation is offscreen or collapsed.
- Evidence: The shared status resolver, approval-state and unread browser journeys cover transitions, badge count, header/pin/details, row placement and offscreen navigation in both themes on desktop and phones.

### UI-group-portrait-separation Distinct member avatars

- Date: 2026-11-07
- Decision: Increase the group portrait from 36px to 44px and its front member from 20px to 24px. Give each photo a 2px circular separator and each shape an equivalent separator following its silhouette. Preserve the bounded five-member composition, bold +N bubble, and animation of only the front face.
- Why: Overlapping faces need visible separation to remain recognizable instead of merging into a single shape.
- Evidence: Group portrait journeys inspect member sizing, silhouette strokes, circular photo outlines and settled light/dark screenshots on desktop and phones.

### UI-public-work-captions Contextual progress without invented thoughts

- Date: 2026-11-07
- Decision: Keep the existing shared TraceLine/TraceTitle shimmer as a single stable activity line. Start briefly with Thinking, then show a real action. Tool completion moves to reviewing its results instead of resetting to Thinking. Keep useful captions while other tool calls finish, and remove the caption as the reply begins. Never add Writing or Finishing once the reply is visible. Agents may use the session-bound pebble_progress tool to choose natural, conversation-specific public captions. Those captions persist through intervening tool lifecycle events and clear on the reply or a new conversation. Do not derive them from hidden reasoning or copy raw commands, tool names, arguments or process output into the line. Progress-only tool records are omitted from visible messages; native tool auditing and raw history coverage are preserved.
- Why: The status line should explain what the owner is waiting for, using the same agent's context and voice. An automatic Thinking reset erases useful information, and a separate model would add cost and make up progress.
- Evidence: Public-caption and live-feedback journeys check actual-action labels, an agent caption across tool calls, private diagnostic exclusion, stable line height and removal when text arrives. Native checks exercise real deferred discovery with catalog listings off and a saved tool selection in disposable homes on both supported Hermes builds. The plugin tool verifies its enrolled caller and current live session before emitting the existing status.update event; it cannot select another agent or conversation.

### UI-section-insertion Reorder sections between their peers

- Date: 2026-11-07
- Decision: A dragged section uses a 40px insertion gap between whole sections, including collapsed or empty sections and the final position. Animate the spacing using the shared panel timing; reduced motion settles immediately. Only the source is dimmed. Conversation placement keeps its distinct row/container targets. Do not save a hover preview or a cancelled drag.
- Why: A container outline suggests nesting the dragged section inside another section, which is not a valid operation.
- Evidence: The [section reorder journeys](../test/chat-workspace/section-reorder.spec.ts) exercise native desktop dragging, first/middle/last positions, cancellation, reload persistence and independent pebble placement. Phone projects drive the same production handlers with native drag events.

### UI-work-caption-continuation Preserve progress after interim replies

- Date: 2026-11-07
- Decision: Pebble Crew's dedicated Hermes child always receives lifecycle events, independently of terminal tool-progress preferences. Streaming text temporarily hides the caption without discarding the agent's current public work context. Real tool activity restores it; turn completion clears it. Ask agents to name the current subject and update captions when they resume work.
- Why: Terminal tool-progress off suppressed all ordinary activity events, and clearing the work context for each text chunk lost the caption after an interim message. The previous test stopped before exercising that continuation.
- Evidence: The [caption browser journeys](../test/chat-workspace/public-captions.spec.ts) stream an interim reply then resume tools and public captions. The [native fixture](../scripts/fixture/progress_smoke.py) uses terminal progress off, deferred tool discovery and an interim reply, verifies later lifecycle events, checks the unchanged terminal display preference, and hashes the persona files.

### UI-history-continuation Load the conversation as the reader scrolls back

- Date: 2026-11-07
- Decision: A deliberate upward wheel, touch or keyboard scroll near the start loads earlier native history. Keep the existing button as an alternative. Prepend with the visible native row anchored. Fill a bounded window through activity-only pages. Keep resolved receipts within the loaded time window; pending input remains reachable regardless of that window.
- Why: Recent-first loading previously required a separate button click, while older receipt cards made the window look like the complete history. Native read-only projection still returned the older user and assistant text.
- Evidence: The [history window journeys](../test/chat-workspace/history-window.spec.ts) hold the response, scroll back through an activity-only page, and check the unchanged anchor and draft. The transcript window unit check keeps pending cards visible.

### UI-conversation-memory Retain bounded inactive agent conversations

- Date: 2026-11-07
- Decision: Keep up to eight inactive agent views with a 6 MiB estimated data budget in memory. Retain loaded messages, stream projection, history cursor and scroll position; leave drafts in their existing owner-scoped store. Restore the view before the network response. Revalidate with the current binding's lightweight snapshot, reopening only when the binding changed. Send waits for validation. Clear the cache on disconnect or owner/workspace change. Do not keep hidden chat trees mounted or persist transcripts in browser storage.
- Why: Each agent switch previously waited for a full native open and discarded the already loaded view. A bounded data cache gives immediate continuity without retaining every screen or treating cached data as server authority.
- Evidence: [Cache unit checks](../apps/web/src/chat/conversation-memory.test.ts) cover eviction, oversize entries, profile mismatch and owner isolation. The [warm browser journey](../test/chat-workspace/conversation-memory.spec.ts) holds the server response and checks cached messages, draft, scroll and later catch-up without another full open.

### UI-model-picker-composition Compose the picker from shared controls

- Date: 2026-11-07
- Decision: Use the shared top-anchored content Dialog, padded search CommandInput, neutral CommandItem rows, compact provider counts, and shared Alert/DialogFooter for model-switch confirmation. Reserve the provider navigation row so its controls do not jump. Keep the full current model identifier visible and provider/model lists separate. Wrap long identifiers instead of clipping distinguishing suffixes. Both /model and /models open this picker. Focus search on desktop after the catalog arrives; focus the dialog on phones so the keyboard opens only when search is tapped. Put keyboard focus on Cancel for an additional confirmation.
- Why: The previous composition nested a default command panel inside a padded dialog and left search, rows, navigation and confirmation with mismatched spacing.
- Evidence: The [picker design journeys](../test/chat-workspace/model-picker-design.spec.ts) cover light/dark padding, current selection, provider navigation, stable header position and search. The existing [command journey](../test/chat-workspace/commands.spec.ts) covers native selection/confirmation and inline results.

### UI-media-touch-dismiss Dismiss photo backdrops on the first tap

- Date: 2026-11-07
- Decision: Recognize a completed one-finger backdrop tap directly from touch events, allowing up to 8 CSS pixels of finger movement. Do not depend on a synthesized click after the zoom surface handles touch movement. A drag, pinch, cancelled touch or touch beginning on the media must keep the viewer open. Preserve the close button and desktop click behavior.
- Why: The zoom handler can cancel the compatibility click after even a tiny finger movement. The previous backdrop click handler therefore ignored a natural tap. Existing phone checks exercised the close button and idealized taps, missing this path.
- Evidence: The [photo viewer journeys](../test/chat-workspace/image-viewer.spec.ts) cover one-tap close and reopen, backdrop taps, slight finger movement, gesture cancellation, pan and pinch. The slight-movement test fails on the previous production build in both phone browser projects.

### UI-document-diagrams Keep diagrams inside the document viewer

- Date: 2026-11-09
- Decision: Render Mermaid and Pele Markdown fences and standalone Mermaid files inside the existing document viewer. Load Pele on demand, show the rendered diagram as a local SVG image, and keep the source available. Wide diagrams scroll within their preview.
- Why: Shared plans can include diagrams that are hard to read as code. The viewer preserves the surrounding document, chat draft, and established attachment access rules.
- Evidence: The [document viewer journeys](../test/chat-workspace/documents.spec.ts) open a fenced diagram, a shared diagram file, and a diagram from the Library on desktop and phone projects.

### UI-document-resize Resize the desktop document viewer

- Date: 2026-11-09
- Decision: Give the document dock a draggable divider with arrow keys and double-click reset. Remember its width separately from navigation and constrain it to the space available beside chat. Phones retain a full-width viewer. Diagrams adapt to the new width after resizing settles.
- Why: Wider diagrams need more room than the fixed details dock gives them. Resizing should preserve the open document and chat.
- Evidence: The [document viewer journeys](../test/chat-workspace/documents.spec.ts) drag the divider, resize from the keyboard, reopen at the chosen width, reset to default, and check that the phone viewer has no divider.

### UI-document-full-page Expand a document across the workspace

- Date: 2026-11-09
- Decision: Use a header toggle to expand the open document across the workspace. Keep the same reader and return to its saved dock width from the header or Escape. The phone viewer already fills the available page.
- Why: Charts and maps can need the entire viewport. The same reader preserves the open document and its source disclosure when changing views.
- Evidence: The [document viewer journeys](../test/chat-workspace/documents.spec.ts) verify full viewport bounds, preserved reader state, sidebar width on return, and Escape.

### UI-hermes-status-dot Show connection status as one dot

- Date: 2026-11-09
- Decision: Use a green dot for the connected Hermes bridge and a gray dot while reconnecting. Put the status text in the dot's accessible label and tooltip. Hover, focus, or tap reveals the tooltip.
- Why: The status stays visible without a permanent label taking space in the sidebar footer.
- Evidence: Desktop and phone checks cover dot color, tooltip access, and the reconnecting state.

### UI-composer-message-type Compact draft typography

- Date: 2026-11-09
- Decision: Preserve the transcript’s own body type at every viewport size. Match the draft to the transcript’s font family, weight and size, with tighter line spacing. Keep the 16 px input minimum on narrow layouts and short touch viewports. Preserve 44 px touch targets. Center the attachment and primary buttons vertically in the one-line bar. As the draft grows upward, keep both buttons on the same fixed bottom row. This applies to explicit line breaks and wrapped lines. Keep the same positions when the draft shrinks back.
- Why: The composer should leave space for the conversation. Keeping the touch input at 16 px avoids the iPhone focus zoom that previously disrupted the layout.
- Evidence: The [typography browser check](../test/chat-workspace/message-typography.spec.ts) checks the draft and its actual sent bubble, preserves the 14 px transcript on wide touch screens, and exercises multiline growth. The [composer control check](../test/chat-workspace/composer-entry.spec.ts) checks both circles against the one-line bar center and asserts that their positions and the lower edge stay fixed while typing, wrapping, adding lines and clearing the draft, in both themes.

### UI-composer-send-receipt Unconfirmed sends stay drafts

- Date: 2026-11-09
- Decision: Show a temporary bubble during submission. On a failed or unconfirmed send, remove the temporary bubble, keep the draft or any newer text, and show delivery status. Display any message later returned in confirmed history. Keep retry manual when delivery is unknown.
- Why: A failed send can look successful when its temporary bubble stays in the transcript. The draft gives the user a way to recover their text.
- Evidence: The [send-recovery browser journey](../test/chat-workspace/connection-recovery.spec.ts) holds the send response, verifies the temporary bubble, then returns a failure and checks that the bubble disappears while the draft returns.

### UI-chat-follow-latest Keep following replies at the bottom

- Date: 2026-11-09
- Decision: Follow live and completed replies when the reader is at the bottom. Keep their place when they scroll up. An event at the last app-written offset remains app-owned after the animation settles. An offset change during layout or automatic following keeps the current reading mode unless a wheel, touch, keyboard or scrollbar gesture accompanies it. Latest messages resumes following.
- Why: Content growth can increase the distance to the bottom before a queued scroll event arrives. That event alone does not mean the reader moved.
- Evidence: The [message motion browser journeys](../test/chat-workspace/message-motion.spec.ts) check delayed events during layout growth, live and completed replies, manual scrolling and restoring the conversation after switching windows.

### UI-native-message-rewrites Keep one bubble per Hermes message

- Date: 2026-11-09
- Decision: Reconcile native chat messages by their Hermes message UID when present. Keep the current numeric row address for reactions, and preserve the rendered bubble identity through send acknowledgements and history rewrites. Older Hermes messages without a UID still use their row address.
- Why: Hermes can replace the database row while retaining the same message UID. Two sends with identical text still have separate identities.
- Evidence: The [send while working browser journey](../test/chat-workspace/send-while-working.spec.ts) submits once and confirms a rewritten row appears once. The [native history fixture](../scripts/fixture/history_smoke.py) verifies the UID in the receipt and the rewritten history.

### UI-photo-sizes Show smaller photo copies and shape stacks by photo

- Date: 2026-11-14
- Decision: Chat bubbles show a copy at most 1280 px on its longer edge. Viewer thumbnails, Library tiles and the back cards of a stack use 360 px copies. The owner host makes, rotates and caches these copies. The viewer shows the chat copy at once and loads the original only for the open photo. Saving always uses the original. A stack card is wide, tall or square to match its top photo.
- Why: Loading every original made chats, stacks and the thumbnail row slow, and wide photos were cropped into tall cards.
- Evidence: The [photo browser check](../test/chat-workspace/photo-gallery.spec.ts) records each requested size on desktop, iPhone and Android. It verifies that no original loads before viewing and that only the open photo's original loads, and it measures wide and tall stack cards. The [plugin test](../test/plugin/test_media.py) verifies resized dimensions, EXIF rotation and a single read of the original.

### UI-message-alerts Alert each device about new messages while the app is closed

- Date: 2026-11-19
- Decision: General settings has one Message alerts switch per device. On iPhone and iPad in Safari it says to add Pebble Crew to the Home Screen first. The owner host keeps the signing key and the device list, encrypts each alert for its device, and sends "Pebble name: reply text" only while no Pebble Crew window is in view on any device, so a chat open on the desktop keeps the phone quiet. Tapping an alert opens that Pebble's chat. An alert and the unread dot mean a message the Pebble sent: its final visible reply. Tool steps, background prompts, the owner's own messages and silent turns never count.
- Why: The owner wants to hear about replies without keeping the app open, and the alert content should stay unreadable to the push service.
- Evidence: The [alerts browser check](../test/chat-workspace/message-alerts.spec.ts) turns alerts on and off, refuses a rejected device, reports app visibility and opens chats from alerts on desktop, iPhone and Android. The [service worker test](../apps/web/src/notifications/service-worker-alerts.test.ts) covers display and taps. The [plugin test](../test/plugin/test_web_push.py) decrypts alerts as a device would and covers in-view suppression, owner messages, silent turns and withdrawn devices. The [reply cursor test](../test/plugin/test_reply_cursor.py) checks real Hermes storage so only a Pebble's final replies move the unread mark.
