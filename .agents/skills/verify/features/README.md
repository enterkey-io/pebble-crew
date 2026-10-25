# Verification feature map

Each journey uses the actual production web bundle. Existing bridge fixtures replace the external Hermes boundary. Native-owner acceptance supplies separate native persistence proof.

| Feature                                 | Journey                         |
| --------------------------------------- | ------------------------------- |
| Add and edit pebbles                    | [Profiles](profiles.md)         |
| Messages, reactions and restoration     | [Chat](chat.md)                 |
| Native device enrollment              | [Devices](devices.md)           |
| Settings and external connections       | [Connections](connections.md)   |
| Org chart, pebbles, sections and Crews  | [Organization](organization.md) |
| Crew goals and proactive help           | [Coordination](coordination.md) |
| Native project boards and tasks         | [Project boards](projects.md)   |
| Private key entry and native live voice | [Voice](voice.md)               |

The complete component vocabulary uses the actual app entry at `/system` in an
explicit workbench build. Run `VITE_SYSTEM_WORKBENCH=1 WORKSPACE_BUILD_ROOT=.audit/system npm run build`,
then `CI=1 WORKSPACE_BUILD_ROOT=.audit/system npx playwright test --config playwright.system.config.ts`.
The general catalog and all 21 AI patterns have typed specimens and state/action/
accessibility checks. They make zero native/provider requests. A normal release
must exclude the workbench chunk; these checks do not replace installed journeys.
