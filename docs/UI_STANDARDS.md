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
| Sections and group chats | Sections organize the sidebar. A group chat has explicitly selected members. Moving a row or adding a shortcut leaves conversation membership and reporting intact. Tap to open. Press and hold in place to show options. Move to start a drag from the row itself. Confirm before deleting a group chat.                                                                                                | [Organization rail](../apps/web/src/ui/OrganizationRail.tsx), [sections and groups contract](SECTIONS_AND_GROUPS_IMPLEMENTATION.md)                                                                                                                         |
| Editors and dialogs      | Use a shared page header or dialog close control. Keep the header and actions reachable when a form scrolls. Put editor tabs and scroll behavior in the shared editor layout. Use the shared discard confirmation for unsaved changes.                                                                                                                                                                   | [Page header](../apps/web/src/ui/primitives.tsx), [editor layout](../apps/web/src/ui/EditorSurface.tsx), [discard confirmation](../apps/web/src/ui/DiscardChanges.tsx)                                                                                      |
| Chat and approvals       | Use shared Message, Prompt Input, and Confirmation compositions. Keep Send, Stop, and Voice in one action position. When composing, show Send. On a phone, Return inserts a line break. Preserve the draft and reading position through navigation and recovery. Keep pending input reachable and leave a compact receipt when resolved. Explain unavailable conversations without launching setup.      | [Transcript](../apps/web/src/chat/Transcript.tsx), [composer](../apps/web/src/chat/ConversationInput.tsx), [AI Elements](../apps/web/src/components/ai-elements)                                                                                            |
| Pins and photo avatars   | Give pin tiles a 100 px minimum and wrap when space runs out. Keep the same filled, single-line role labels as the roster. Show circular photo thumbnails from the owner host, reserve their space on startup, and reuse loaded photos when a section reopens.                                                                                                                                           | [Pinned tile](../apps/web/src/ui/PebbleTile.tsx), [layout](../apps/web/src/ui/layout.css), [avatar delivery](../plugins/bot-web/workspace.py)                                                                                                               |
| Message mentions         | Resolve known public handles, native profile aliases and unambiguous local roster aliases to stable identities in direct and group messages. Use neutral inline controls with a visible underline, keyboard focus and a read-only profile popover. Preserve the original token and copy text.                                                                                                            | [Mention rendering](../apps/web/src/chat/MessageMention.tsx), [identity lookup](../apps/web/src/chat/mentions.ts)                                                                                                                                           |
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

### UI-video-self-view Keep camera preview local

- Date: 2026-11-06
- Decision: Keep Video separate from audio provider selection. Fit the call frame to the avatar stream's dimensions and limit its height so chat and approvals stay accessible. Place the opt-in local camera preview inside the lower-right corner of the video.
- Why: The user can see their camera while speaking and can resolve Hermes requests without ending the call.
- Evidence: The [video browser journey](../test/chat-workspace/atmee.spec.ts) checks portrait and landscape framing, self-view placement, and verifies that only the microphone is published.

### UI-video-call-notes Show what is shared with the character

- Date: 2026-11-06
- Decision: Put optional Call notes below the selected character in the Video section. Use the shared Label, Textarea, and Button, with one explicit save. Place the Atmee sharing disclosure next to the field. Keep Video available in the Voice tab when audio providers are unavailable.
- Why: Preferences apply to the selected character, and users should see what Atmee receives before saving.
- Evidence: The [video browser journey](../test/chat-workspace/atmee.spec.ts) saves notes and confirms that the room sends them only to the character.

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
