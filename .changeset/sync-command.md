---
'dorfl': minor
---

Add `dorfl sync` to bring an already-onboarded repo up to the current protocol.

It re-syncs `work/protocol/*` from the package's canonical contract docs and bumps `work/protocol/VERSION` (idempotent: a no-op when already current), so a repo that adopted an older protocol picks up the latest in one command rather than re-running the whole `setup` skill. `--dry-run` previews the re-sync without writing.

It can also refresh the operator's packaged skills: pass `--add-skills` to install them non-interactively (the flag bypasses the prompt), or answer the one-time confirmation an interactive run shows (a non-TTY run skips skills so a scripted `sync` never hangs). `--local` scopes that skills install to `<cwd>/.agents/skills/`.

The protocol re-sync engine (`resyncProtocol` / `PROTOCOL_DOCS`) is now shared between `sync` and `prd-to-spec` via a new `resync-protocol` module (behaviour unchanged for `prd-to-spec`).
