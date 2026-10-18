# Implementation progress

This is a read-only developer status board. It contains build tasks, never Hermes
credentials, conversations or owner data. The server listens on loopback; a
separate Tailscale Serve route makes it available privately.

```sh
node scripts/progress/board.mjs start
node scripts/progress/board.mjs update u1.catalog doing "Building the shared catalog."
node scripts/progress/board.mjs update u1.catalog done "Catalog checks passed."
node scripts/progress/board.mjs wait u1.catalog "Which option do you prefer?"
node scripts/progress/board.mjs unwait u1.catalog
node scripts/progress/check.mjs
```

Update the addressed task after every completed implementation task and when
starting the next one. Mark a task waiting only when a real owner question is
pending. State lives in `.audit/shadcn-implementation/status.json`; updates are
atomic and reach open browsers through a server event stream. The page follows
the current phase unless its viewer selects another phase. Browser checks use
an isolated temporary state file.
