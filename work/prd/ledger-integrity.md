---
title: ledger-integrity — the work/ lifecycle ledger must be one-slug-one-folder, arbiter-is-truth, and atomic across EVERY transition (claim / integrate / recover / onboard / requeue)
slug: ledger-integrity
blockedBy: []
covers: []
---

## Problem Statement

The `work/` folder IS the ledger: a slice's STATUS is which folder its single `.md` lives in (`backlog/` → `in-progress/` → `done/`, or `→ needs-attention/`), with NO index, NO frontmatter status field, ONE file per item (WORK-CONTRACT.md). The whole protocol trusts that invariant. But across a long drive-backlog session, **multiple independent paths were found to violate or mishandle it** — the ledger is not rigorously enforced as *one-slug-one-folder, arbiter-is-truth, atomic-transitions* on every code path that moves an item. The failures are not cosmetic: each one made a slice's real state ambiguous and cost recovery effort (or risked double-work).

Concretely, this session surfaced four distinct ledger-integrity defects (each captured as an observation):

1. **Orphaned `in-progress/` after merge** (`pr-merge-leaves-orphaned-in-progress-when-claim-landed-on-main.md`). The CLAIM pushes `in-progress/<slug>.md` to the arbiter main independently of any PR. When a PR/recovery branch computes its done-move against a DIFFERENT base, the squash-merge ADDS `done/` WITHOUT removing `in-progress/` — the "move" becomes a "copy", leaving a ghost. Traced precisely on PR #86 (`93ef12c`'s tree had the slug in BOTH folders). A stale `in-progress/` ghost makes a DONE slice read as claimable/in-flight → wasted recovery investigation (it happened) or a double-claim.

2. **`requeue` only recovers from `needs-attention/`, not `in-progress/`** (`requeue-only-works-from-needs-attention-not-in-progress-stuck-claims-unrecoverable.md`). A slice STUCK in `in-progress/` (claimed, never surfaced — e.g. a push failed before the needs-attention route, or a killed run) cannot be requeued; the conductor's standard recovery verb ERRORS, and the item is stranded until a human hand-moves it. Asymmetric: needs-attention is recoverable, the equally-stuck in-progress is not.

3. **The onboard find-slice is blind to `done/`** (captured in the `finish-already-committed-branch` slice's Open questions, and the `recover-stranded-green-work` analysis). `resolveSlice` (`prompt.ts`) looks ONLY in `in-progress/` + `backlog/`, so a continue/re-claim onto an already-done-moved branch fails with "no slice found". The conductor hand-moved the slice `done/ → in-progress/` on the branch to work around it this drive.

4. **A stranded already-committed, already-done-moved branch has no first-class finish path** (the `finish-already-committed-branch` slice — the re-scope of `recover-stranded-green-work`). When a terminal push fails AFTER done-move+commit, `complete` REFUSES it (`IntegrationNothingStaged` — it resolves source as in-progress/needs-attention, never `done/`), so the green work is stranded.

These are all the SAME root theme: **a status transition that is not atomic-against-the-arbiter's-current-state, or a reader/recovery path that doesn't account for every legitimate folder an item can be in.** Fixing them piecemeal leaves the invariant unenforced; this PRD hardens the ledger as a whole.

## Solution

Make the `work/` ledger rigorously enforce three properties on EVERY path that moves or reads a slice, and add the recovery paths the lifecycle is missing:

- **One-slug-one-folder** — a slug's `.md` exists in EXACTLY ONE status folder at any time on the arbiter; a transition that would leave it in two FAILS loudly (or atomically cleans the stale source). A `status`/`scan` lint surfaces any existing duplicate.
- **Arbiter-is-truth + atomic transitions** — every transition (done-move, requeue, surface, recover) resolves the slug's ACTUAL current folder ON THE ARBITER and moves it as ONE atomic rename published via the tree-less CAS (the `#89`/`ledgerWrite.applyTransition` model), never a copy/add computed against a divergent base, never a working-tree-dependent move.
- **Every legitimate folder is reachable by the readers/recovery verbs** — onboard (`resolveSlice`), `requeue`, and the integrate/recover paths each handle the full set of folders a slug can legitimately be in, with safe disambiguation (a `done/` slice that is genuinely COMPLETE vs one that is a STRANDED strand must be distinguished by more than the folder name).

This is a HARDENING PRD over existing primitives (the tree-less CAS transition #89, the surface mechanism, the integration core) — it does not introduce a new ledger model; it makes the existing one's invariant true on every path.

## User Stories

1. As the protocol, I want a slice's done-move to be ATOMIC against the arbiter's CURRENT status folder — `complete`/the integration core resolves the slug's actual source folder (`in-progress`/`needs-attention`) on the arbiter and `git mv`s it to `done/` as one staged rename — so a merge can NEVER land `done/` while leaving an `in-progress/` ghost (closes defect 1).

2. As the maintainer, I want a ONE-SLUG-ONE-FOLDER invariant enforced: an integration (or any transition) that would leave a slug in two status folders FAILS loudly (or atomically removes the stale source), so a corrupt ledger can never be published (closes defect 1's root).

3. As the maintainer, I want `status`/`scan` to LINT the ledger — warn (never silently) when any slug appears in more than one `work/` status folder — so an orphan from a past or hand-built merge is findable, and the drive isn't misled into "recovering" an already-done slice.

4. As the conductor, I want `requeue` to recover a slice from `in-progress/` too (not only `needs-attention/`): it resolves the slug's actual current folder on the arbiter and moves it to `backlog/` via the same tree-less CAS (keep+continue by default; `--reset` discards), so a stuck-in-progress claim is recoverable exactly like a needs-attention one (closes defect 2). At minimum, a `requeue` on an in-progress slug must give a CLEAR actionable message, never a bare "not found".

5. As the runner, I want onboard (`resolveSlice`) to find a slice that is in `done/` on a CONTINUE — so a re-claim of an already-done-moved branch doesn't fail with "no slice found" — WITHOUT making `do` re-onboard a genuinely-complete slice (a `done/` slice that is COMPLETE vs a STRANDED-but-unpushed strand must be disambiguated by tip-vs-arbiter state, not folder alone) (closes defect 3, safely).

6. As the operator, I want a first-class way to FINISH an already-committed, already-done-moved stranded branch — integrate from the commit already on it by running ONLY the rebase→integrate tail (skip done-move+commit), threaded through the shared integration core, with unspoofable detection (an already-integrated slice is a clean no-op, never a double-integrate) (closes defect 4; this is the `finish-already-committed-branch` slice).

7. As the maintainer, I want these to COMPOSE with what already landed — the stale-lease surface (#97) surfaces a terminal push failure to `needs-attention/`; story 6 FINISHES from that surfaced/stranded state; story 4 recovers a stuck in-progress claim — so the recovery story is complete and consistent (try-retry → else-surface → then-finish/requeue), not a patchwork.

## Implementation Decisions

(To be confirmed with the maintainer during slicing — do NOT relitigate once set.)

- **Reuse, don't reinvent.** The tree-less CAS transition (`ledgerWrite.applyTransition`, #89), the needs-attention surface mechanism, and `performIntegration`'s rebase→integrate tail are the primitives; every story threads through them. No second ledger model, no new lock.
- **The arbiter is the source of truth for the ledger.** Every transition resolves the slug's current folder from the arbiter (fetch-first), never from a possibly-divergent local/branch tree (the entanglement lesson). Hand-built recovery branches must obey the same resolve-source-then-move rule.
- **`done/` disambiguation (story 5/6) is by TIP-vs-ARBITER state, not folder.** A `done/` slice whose work-branch tip is reachable on `<arbiter>/main` is COMPLETE (no-op / don't re-onboard); one whose tip is committed-but-unpushed is STRANDED (finishable). The find-slice / recover paths use this, never folder name alone — this is the safety crux (a careless `done/`-accepting onboard could re-run a finished slice).
- **Fail loud over silent-clean where ambiguous.** The one-slug-one-folder guard prefers a loud failure; auto-cleaning a stale source is allowed only when provably safe (identical content + the canonical folder is unambiguous), mirroring the manual cleanup the drive did (commit `279b542`).

## Source material (observations + slices to fold in)

- `work/observations/pr-merge-leaves-orphaned-in-progress-when-claim-landed-on-main.md` (defect 1 — root cause traced).
- `work/observations/requeue-only-works-from-needs-attention-not-in-progress-stuck-claims-unrecoverable.md` (defect 2).
- `work/backlog/finish-already-committed-branch.md` (defect 4 + the `prompt.ts` onboard note for defect 3 — already a reviewed slice; this PRD gives it its home + the surrounding stories).
- `work/needs-attention/recover-stranded-green-work.md` (the parked original, superseded — its empirical analysis is source).
- Cross-ref the SHIPPED `stale-lease-retry-all-push-sites-and-treeless-surface` (#97, the surface-on-terminal-failure half) and `requeue-treeless-transition` (#89, the tree-less CAS) — the primitives this composes over.

> Slicing note: `finish-already-committed-branch` is already a reviewed, claim-ready slice — when this PRD is sliced, ADOPT it as the slice for story 6 (set its `prd: ledger-integrity` + `covers`) rather than re-cutting it; the other stories (1–5, 7) are new slices. Stories 1+2+3 (atomic done-move + one-slug-one-folder invariant + lint) are tightly related and may be ONE or two slices; 4 (requeue from in-progress) and 5 (safe `done/`-aware onboard) are independent.
