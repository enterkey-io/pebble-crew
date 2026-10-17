# Agent-managed updates and recovery

Use published immutable upstream releases. Ordinary users do not need a fork; a
fork is appropriate only for maintained custom code.

Keep private state outside release/code directories: app settings/signing keys and
owner auth/session SQLite or D1, plus Hermes connection/trust/workspace state and
all native profiles/history/assets/credentials. Back these up privately before
maintenance. Never commit them to Git or include them in software packages.

Stage new artifacts/dependencies in a new release directory, verify checksums and
compatibility, run the relevant checks, and confirm native work is idle. Switch
only versioned app/plugin code and restart the supervised services. Do not rotate
issuer/audience/signing keys or overwrite connection config during routine updates.
Run `hermes bot-web sync-runtime --source-package --native-idle` after replacing the main integration to refresh
its enrolled profile copies with private rollback backups. A mismatched runtime
copy is an update problem, not permission to silently overwrite unrelated code.

Verify the actual HTTPS route and trust with `hermes bot-web probe`, check owner
login persists and the browser reconnects to its canonical chat. Roll back code and
compatible app/workspace schema state when necessary, preserving unrelated native
conversations and credentials. Do not claim rollback was tested simply because a
backup directory exists.

For Node login recovery, the operator runs the bundled owner CLI `recover --state
PRIVATE_STATE_DIRECTORY`, then privately delivers the new one-use proof. Existing
app sessions are revoked. Already minted Hermes tickets have a maximum five-minute
lifetime. Recovery keeps the installation's signing binding. Cloudflare recovery
requires account access and a reviewed D1 transaction, never a public reset link.

There is no unattended automatic update channel or release signing/provenance
claim yet. SHA256SUMS plus the release manifest verify the published package set;
keep production certification separate from development preview evidence.

0.5.0 adds optional presentation/read-cursor tables without changing the workspace
schema. Old code ignores them; keep them during rollback. Profile incarnation
witnesses and the separate `pebble-crew` native metadata namespace must survive
code-only updates. Pending 0.5 Delete/Hide requests are unsupported by older code;
never approve them after downgrade. Return to the matching release to review
them. A same-name profile restored by copying to a new directory receives a new
incarnation and does not inherit a destructive approval or retired public handle.

## Runtime compatibility evidence

`hermes bot-web runtime-status` reads only owner-local disk state. It reports the
active host digest, package digest, enrolled-copy digests and declared runtime
contracts. It does not publish profile inventory through public version metadata.
Loaded runtime remains `unknown`; even matching disk digests do not establish
what an existing native process imported.
An enrolled native bot may have no integration runtime yet. Status reports
`not-installed`; synchronization can provision that absent copy. An existing
partial or unknown copy requires inspection and is never treated as absent.

Before maintenance, wait for native work to finish and stop profile processes.
`--native-idle` records the operator's confirmation, not observed process state.
For an update, `--source-package` selects the new verified plugin package while the
host still points at its old immutable release. The preflight requires mutual
compatibility before touching any copy. The supported transition is the exact
pre-contract runtime fingerprint from `b642cce` and the `workspace-runtime-v1`
contract, exercised by the synthetic lifecycle gate. Unknown fingerprints are
unverified, not diagnosed as incompatible. They require a tested migration before
activation; do not force a contract label onto custom or unknown runtime code.

Each synchronization saves a private receipt and per-profile backup. A failed
profile leaves earlier copies explicitly listed and never reports completion.
The root installation package is preserved so its web bundle remains usable.
After activation or rollback, restart stopped profile processes and verify the
public route. To restore enrolled runtime copies to the active rollback release,
run `hermes bot-web sync-runtime --native-idle` without `--source-package`.
Keep the receipt and backups until recovery is verified. Neither synchronization
nor a healthy bridge certifies the code loaded by independent native processes.

Before publishing a newly built combined package, set `HERMES_NATIVE_ROOT` and
`HERMES_NATIVE_PYTHON` to the isolated supported native test installation and run
`node scripts/verify-release.mjs`. It checks the existing final archive in a
disposable home and rejects failed acceptance or a changed archive digest. It
writes `artifacts/installed-package-acceptance.json`; it never publishes a release
or changes an owner's installation. CI runs the same command after packaging.
The historical Python-runtime rollback check needs repository history containing
`b642ccef86511814223e9c4443fc48f639965b47`. It uses that exact Python payload with
the candidate's web assets and dependencies; it does not certify the old web UI.
