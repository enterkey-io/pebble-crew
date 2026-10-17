---
name: verify
description: Drive the actual Pebble Crew web app through its production browser and native-owner checks. Use when verifying UI, profile, chat, connection, or install changes in this repository.
---

# Verify Pebble Crew

Use the production app and existing test runners. Keep synthetic evidence separate from owner acceptance. Never run a model, alter a persona or update a service on an owner's Hermes during verification.

## Launch

From the repository root, run `npm run check`. This checks types, lint, shared UI contracts, formatting and unit behavior, then builds the production web and owner bundles. If dependencies are absent, use the pinned Node version in `.nvmrc` and run `npm ci --ignore-scripts` first.

If Playwright browsers are absent, run `npx playwright install chromium webkit`. Linux runners also need browser system dependencies; CI uses `npx playwright install --with-deps chromium webkit`. The audit exercised this recipe with npm dependencies and browser binaries already installed, not on a fresh host.

The browser runners launch and stop their own loopback static server. Use `CI=1` so they refuse to reuse a server another session started. Desktop uses 8093, mobile uses 8097. Run them sequentially. Production assets are served from `apps/web/dist`; do not substitute `ui-lab`, a mock review component or a development theme.

## Doctor

Check `git status --short --branch` and the versions in `release.json` and `apps/web/dist/version.json`. A matching version identifies the reported release, not source freshness. Run the build above before testing. A busy test port is a failure to isolate the run. Do not kill an existing listener or reuse it.

For each journey, install the repo's bridge fixture and require the Message field to become enabled before proceeding. Existing browser specs do this. A 200 from the static server alone is not readiness.

For native acceptance, set `HERMES_NATIVE_ROOT` to the isolated source checkout at the revision pinned in `.github/workflows/check.yml`. Set `HERMES_NATIVE_PYTHON` to its prepared virtual environment with that source installed and `test/plugin/requirements.txt` installed. Check those paths exist. Then run `npm run test:owner-browser`. The script creates a disposable home, owner login, TLS fixture and deterministic localhost model. Its default `/private/tmp` paths are this developer machine's convenience, not installation instructions for another host.

## Drive

Use the [feature map](features/README.md) to select relevant existing specs. One focused example is:

```sh
CI=1 npx playwright test --config playwright.chat.config.ts setup-continuity.spec.ts --grep 'existing pebble setup'
```

For phone proof of the same behavior, run:

```sh
CI=1 npx playwright test --config playwright.mobile.config.ts setup-continuity.spec.ts --grep 'existing pebble setup'
```

Use ARIA labels and existing fixture helpers for exploratory cases. The flow above opens New, New pebble, Add existing Hermes agent, chooses Existing Example, edits Name, Description, Reports to and Responsibilities, then interrupts the stream. It must keep the dialog and values, reconnect, and show no transient red interruption banner. The existing Messages/Settings UI must remain mounted. This is a real production UI with the external bridge boundary simulated, not native persistence proof.

Run `npm run test:owner-browser` when a profile, avatar, setup or chat contract changes. Run `node scripts/test-installed-plugin.mjs` against the final packaged archive for install, update, rollback or supervision changes. Prepare its explicit native paths and package first. Do not repackage or rebuild while a native or installed-package run uses those files.

## Evidence

Keep command output in a task-specific log under `test-results/verification/` or an ignored local audit directory. Desktop screenshots are under `test-results/chat/`; phone screenshots are under `test-results/mobile/`; native screenshots are under `test-results/owner/`. Open the settled screenshots, including iPhone and Android for UI changes. A saved screenshot is not a visual review until inspected.

Record the source revision, build/release, command, result and evidence paths. Browser emulation does not prove a physical keyboard, mobile Safari or all-device performance. Native synthetic proof does not establish an owner's ingress or restart behavior. Review metadata from the served owner URL before attributing an owner report to current source, using no credentials or private API data.

Counterexample checks in `scripts/audit-agent-guards.mjs` and `scripts/audit-photo-routing.mjs` now assert the repaired behavior, retaining the historical broken UI sources as negative controls. They complement the real browser/native gates. The final archive must pass `scripts/verify-release.mjs` unchanged before publication; its historical Python rollback fixture needs repository history containing `b642ccef86511814223e9c4443fc48f639965b47`.

## Cleanup

Playwright stops the web server it launched. The native/installed runners clean up their own child processes and temporary homes in `finally`. If a run is interrupted, stop only process IDs and directories that the run recorded as its own. Never kill by process name. Keep screenshots, reports and logs after cleanup and confirm they still exist.

## Helpers

Use the existing package scripts and spec helpers. No separate browser driver or owner credentials are required. Recheck the feature map when routes change, using pstack's maintain-verification-skill workflow when available.
