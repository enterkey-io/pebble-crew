# Interaction polish: 0.7.8

Use the installed Radix, Motion and CSS foundation. Implement the interaction
ideas independently; do not copy React Bits components or add its registry.

## Structure

| Area           | Chosen implementation                                     | Alternative rejected                                          |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Tooltip timing | Shared Radix provider: 350ms cold, 300ms warm window      | Another tooltip engine and positioning lifecycle              |
| Activity       | One local Motion presence boundary in the reserved lane   | Retained text plus a second timer/generation lifecycle        |
| Composer       | One button with immediate semantics and a glyph crossfade | Replacing action targets or delaying semantics during exit    |
| Startup        | One quiet progress view until initial restoration settles | Rendering an empty conversation picker between startup phases |

`ActivityLine` owns presentation only. Native events still determine labels and
completion. A persistent screen-reader status clears immediately when idle; the
hidden visual copy stops shimmering and fades out over 120ms. A new run cancels
settlement, while a conversation-key boundary discards activity from another
chat. Reduced motion is static. No invented reasoning, progress or completion.

`ComposerAction` preserves the existing target, submit/cancel handlers, disabled
conditions and dimensions. Only its arrow and square crossfade. Stopping is
announced immediately without overflowing the circular button. A held gesture
cannot activate a different action, and repeated Enter does not stop a run that
the same held key just started. Draft, IME and upload ownership remain in App.

`StartupScreen` is shared by the authentication and Hermes connection stages.
Show a thin indeterminate bar and, after authentication, a subdued Sign out
control aligned below its left edge. Keep the bar's position stable between
stages. Do not expose an empty picker while the initial native conversation is
still opening. Once mounted, the application remains mounted through transport
recovery. Missing or inaccessible defaults leave other conversations available;
API-only clients retain their real picker. Ref-dependent transcript/composer
effects also run when delayed initial mounting finishes.

The pending phone message-width correction is included: long owner messages can
use 88% of the conversation width, while short messages stay compact and desktop
owner messages keep their existing width.

## Delivery and acceptance

1. Root implements; Astra supplies a read-only plan and independent review.
2. Establish failing-before browser checks for cold hover, activity settlement,
   glyph feedback and held-action cancellation.
3. Exercise the production application on desktop, iPhone/WebKit and
   Android/Chromium. Sample real frames for transitions; inspect settled images
   for startup, chat and phone geometry.
4. Check rapid runs, stop failure/retry, deliberate conversation switching,
   reduced motion, stable rows/timestamps, reactions, scrolling, uploads and
   draft/navigation continuity through reconnection.
5. Run source checks and native-owner acceptance against disposable Hermes and a
   deterministic localhost model. Do not probe an owner's models or services.
6. Package once, run exact-archive install/update/rollback acceptance, then
   publish that verified archive and its checksums. Preserve existing owner state.

Crew semantics, ad hoc chats, agent conversation overlays and new avatar/status
engines are separate work. This change adds no third-party component source or
dependency and makes no new cross-platform performance claim.
