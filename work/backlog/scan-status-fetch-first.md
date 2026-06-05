---
title: scan-status-fetch-first — scan/status fetch the truth first; retire the offline-scan invariant
slug: scan-status-fetch-first
prd: command-surface-phase-2
blockedBy: [registry-remote]
covers: [20]
---

## What to build

Make `scan` and `status` **fetch the truth first** (ADR §5/§6), retiring the old
"scan is always offline" invariant (which was the roots-local model).

- **`scan`** — fetch the registry's current state before reading the cross-repo
  queue (the remote is the source of truth in the registry model); on a failed
  fetch, **fall back to last-known and WARN** (do not fail). The freshness of the
  queue then reflects the last successful fetch.
- **`status`** — likewise fetches before reporting the operational dashboard;
  warn + fall back offline on failure.
- **Retire the offline-scan invariant** in docs/comments: the older "scan is always
  offline" framing (roots-local) is superseded; this is a deliberate, recorded
  change (CONTEXT.md already notes the retirement — align code + any lingering
  comments to it).

Important scope guard: this is about `scan`/`status` FETCHING FIRST, **not** about
changing the ledger read strategy. The ledger read seam's offline read of
`<arbiter>/main:work/...` stays as the single strategy
(`docs/adr/claim-ledger-vs-protected-main.md`) — `scan`/`status` simply ensure the
mirror is freshly fetched before that read, then warn + use last-known if the fetch
fails. Use the existing mirror-fetch primitives (`fetchMirrorMain`/`ensureMirror`);
do NOT introduce a `ledgerMode`/new ref/network-ledger.

**Builds on the mirror-ref READ from `registry-remote` (depends on it).** This
slice does NOT change WHAT `scan`/`status` read or HOW they read it — by the time
this lands, `registry-remote` has already moved `scan`/`status` to read `work/`
from each hub mirror's `main` ref (mirrors are bare; the read-seam capability
`registry-remote` added does `git ls-tree`/`show` against `<mirror>/main:work/...`).
THIS slice adds only the **fetch step before that read**: refresh each mirror's
`main` (via `fetchMirrorMain`/`ensureMirror`) so the ref the read seam reads is
current, with warn + fall-back-to-last-known on a failed fetch. So it is a thin
fetch-then-read layer on the read `registry-remote` built — not a new read.

## Acceptance criteria

- [ ] `scan` fetches the registry's mirrors before computing the queue; on a fetch
      failure it warns and falls back to last-known (does not error out).
- [ ] `status` fetches before reporting; same warn + fall-back-offline behaviour.
- [ ] The change uses the existing mirror-fetch primitives; the ledger read strategy
      is UNCHANGED (no new ref, no `ledgerMode`, no network-ledger).
- [ ] The retired offline-scan invariant is reconciled in code comments/docs (no
      lingering "scan is always offline" claim that contradicts CONTEXT.md).
- [ ] Tests (local `--bare` arbiter): `scan`/`status` fetch first (a change pushed
      to the arbiter is visible after fetch); a simulated fetch failure warns +
      falls back to last-known without erroring.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `registry-remote` — it moves `scan`/`status` to read `work/` from each hub
  mirror's `main` REF (mirrors are bare) via the read seam; THIS slice only adds the
  FETCH before that read. The mirror-ref read must exist first (and this serialises
  the cli.ts/scan/status edits after the foundation).

## Prompt

> Make `scan` and `status` FETCH THE TRUTH FIRST per `docs/adr/command-surface-and-
> journeys.md` §5/§6, retiring the old "scan is always offline" invariant: fetch the
> registry's mirrors before reading; on a failed fetch, WARN and fall back to
> last-known (never error out). SCOPE GUARD: this is fetch-first ONLY — do NOT change
> the ledger read strategy (no new ref, no `ledgerMode`, no network-ledger); the
> offline `<arbiter>/main` read stays the single strategy.
>
> FIRST run the drift check: confirm `registry-remote` (in `done/`) made `scan`/
> `status` read the hub-mirror registry; confirm CONTEXT.md's "scan's offline
> guarantee is RETIRED" note (the decision you are implementing) and the mirror-fetch
> primitives (`fetchMirrorMain`/`ensureMirror` in `repo-mirror.ts`). Confirm
> `docs/adr/claim-ledger-vs-protected-main.md` (the read seam is single-strategy —
> do not touch it). Route to needs-attention on a discrepancy.
>
> READ FIRST: ADR `command-surface-and-journeys` §5/§6 (scan/status fetch-first;
> mirror freshness — the fetch is baked in; the two load-bearing refspecs must not
> be simplified away), CONTEXT.md "scan's offline guarantee is RETIRED",
> `src/scan.ts` + `src/status.ts` (where the fetch goes), `src/repo-mirror.ts`
> (`fetchMirrorMain`/`ensureMirror`), and `docs/adr/claim-ledger-vs-protected-main.md`
> (do NOT change the read strategy).
>
> Implement fetch-first in `scan`/`status` using the existing mirror-fetch
> primitives, with warn + fall-back-offline on failure. Reconcile the lingering
> offline-scan comments to the retirement.
>
> TDD with vitest, house style (local `--bare` arbiter): a pushed change is visible
> after fetch; a simulated fetch failure warns + falls back without erroring. "Done"
> = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim scan-status-fetch-first --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/scan-status-fetch-first <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/scan-status-fetch-first.md work/done/scan-status-fetch-first.md
```
