# Profiles

## Sub-features

First use, importing an existing Hermes profile, creating a new profile, editing identity/avatar/role/reporting, and preserving unsaved setup during restoration.

## How to get to it (user POV)

Use New in the left rail, then New pebble. Choose Add existing Hermes agent or Create new pebble. Open Edit from a pebble's action menu for an enrolled profile. First use starts with the existing primary Hermes agent, not a placeholder.

## Driving it with Playwright

Run `CI=1 npx playwright test --config playwright.chat.config.ts owner-ui.spec.ts setup-continuity.spec.ts profile-recovery.spec.ts role-instructions.spec.ts`. Drive Name, Handle, Title, Description, Reports to, Instructions, avatar and photo controls through their labels. Title and Description live in Profile; Role contains reporting and one optional Instructions field. Save, reopen and assert persistence. Run the mapped continuity and instruction specs on `playwright.mobile.config.ts` too.

The instruction journey preserves all older role text, measures label/field
separation, retains a whole instruction draft across an agent's concurrent edit,
and saves/reopens text longer than the old 1,000-character field limit. Native
owner acceptance exercises that larger value while preserving the existing SOUL.

Native persistence is covered by `npm run test:owner-browser` using synthetic profiles, original SOUL sentinels and a local model. It must preserve persona/model data and reject reporting cycles before native writes.

## Gotchas

Native owner acceptance uses a detailed 512px image and checks that the full profile request exceeds 64 KiB on `/v1/avatar`, then reopens the saved photo after selecting a shape. Profile recovery covers unsaved Tools choices, uncertain saves and a transient import refresh. Native runtime digest/status is separate from profile-field persistence; neither establishes already loaded process code.
