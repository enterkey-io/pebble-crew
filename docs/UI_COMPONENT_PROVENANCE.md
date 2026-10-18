# UI foundation source and verification

Pebble Crew owns its shadcn React component sources. The installed application,
review entry and component workbench use `apps/web/src/main.tsx` and the same
`ui/theme.css` graph. The workbench provides local samples; it does not connect
to Hermes or replace the installed application journeys.

## Sources and local changes

The original 20 primitives came from the official
[Radix registry](https://ui.shadcn.com/docs/components) using New York style on
2026-10-16. The expanded catalog was imported with the official shadcn CLI
4.22.0 on 2026-10-17 using `radix-nova`, which includes the current conversation
primitives. Existing customized sources were preserved during that import.
The MIT notice remains in [licenses/shadcn-ui.txt](licenses/shadcn-ui.txt).

The CLI is an import tool, not a project dependency. Its unchanged utility source
is owned in `ui/shadcn-utilities.css` (formatting/header only); the original SHA256
is recorded there. Keeping that CSS beside the other owned sources removes the
CLI's unused registry/glob dependency chain from ordinary builds and packages.

The complete inventory and intended uses live in the executable
[`catalog.ts`](../apps/web/src/ui-lab/catalog.ts) manifest and
[coverage ledger](SHADCN_COVERAGE.md). `node scripts/sync-ui-catalog.mjs --check`
checks that the tables match. Registry updates require a diff review; do not
blindly overwrite owned components.

Local registry changes preserve neutral selection, quiet action variants,
shared motion timing, phone targets, stable editor geometry and bare reactions.
Slider thumbs have accessible labels; Progress passes its measured value to
Radix. Calendar and Shiki option construction respect optional values. Sidebar
persistence belongs to its caller rather than a second cookie. These sources
are building blocks; they do not own profile drafts, native authority or chat
history.

Card and Attachment support `asChild` to retain native section/list semantics.
Label owns stacked field alignment; Textarea supports caller-controlled sizing.
Table can defer its horizontal viewport to the existing Markdown scroll owner.
The installed transcript and workbench render the same complete Message
composition: an end-aligned Bubble for owner text, unboxed agent Markdown and
MessageFooter actions/metadata. Message and Bubble own layout. Feature code owns
native receipt identities, reactions, selected-Pebble colors and entrance motion;
product CSS cannot override message geometry. Markdown uses Typography, Code
Block and Table directly, including their own horizontal overflow behavior.

Form, Number Field, Tags Input, Data Table, Date Picker, Stepper and Typography
are local semantic compositions. Pin Input and Range Calendar reuse the code
and date inputs. Combobox composes the existing Radix Popover and Command.
Toast and Sonner share one Sonner implementation and the application theme;
there is no second theme provider. The 21 AI compositions use these same
primitives without an AI SDK runtime or model provider dependency.

Dependencies are pinned in the manifests and lockfile:

| Dependency             | Version | Purpose                                          |
| ---------------------- | ------- | ------------------------------------------------ |
| radix-ui               | 1.8.1   | Accessible behavior, focus, portals and menus    |
| @shadcn/react          | 0.3.1   | Questionnaire and standalone scroller primitives |
| Tailwind               | 4.3.3   | Semantic theme utilities                         |
| Motion                 | 14.3.0  | Existing layout and message motion               |
| Lucide React           | 1.58.0  | Interface icons                                  |
| cmdk                   | 1.1.1   | Search and command pickers                       |
| date-fns               | 4.4.0   | Date formatting                                  |
| react-day-picker       | 10.0.2  | Calendar behavior                                |
| input-otp              | 1.5.0   | Code input                                       |
| embla-carousel-react   | 8.6.0   | Media carousel                                   |
| react-resizable-panels | 4.14.5  | Resizable surfaces                               |
| recharts               | 3.8.0   | Reserved chart presentation                      |
| shiki                  | 4.5.0   | Local code highlighting                          |
| sonner                 | 2.0.8   | Notifications                                    |
| vaul                   | 1.1.2   | Touch drawers                                    |

Heavy specimens are loaded with the workbench. Its standalone upstream scroller
is not an additional controller for the installed transcript: `TranscriptFollow`
remains the sole owner of installed viewport movement.

## Workbench

Run `npm run dev`, then open `/system` on the development server. For an isolated
production build with the same entry and theme:

```sh
VITE_SYSTEM_WORKBENCH=1 WORKSPACE_BUILD_ROOT=.audit/system npm run build
CI=1 WORKSPACE_BUILD_ROOT=.audit/system npx playwright test --config playwright.system.config.ts
```

The route is enabled only in development or an explicit workbench build. A
normal release does not expose it. General and AI catalogs provide controlled
local states, including unavailable native operations. Those previews establish
component behavior, not Hermes capability support.

CI runs the workbench in its own job across Chromium and WebKit. The normal
build is checked separately by `scripts/check-release-ui.mjs`, which rejects
workbench chunks and mismatched version metadata. Source archives include the
workbench runner and maintained verification skill.

`npm run check:ui` checks the catalog tables and actual screen compositions,
rejects raw migrated native operations and transport/persistence in AI elements,
and prevents installing the registry scroller beside `TranscriptFollow`.
`node scripts/audit-system-contract.mjs` checks seven intentionally broken
counterexamples, including a shared import left unused after bespoke rendering
returns. These guards supplement browser/native behavior checks.

Use the [verification skill](../.agents/skills/verify/SKILL.md) for installed
screens and isolated native-owner checks. Workbench tests supplement those gates.
