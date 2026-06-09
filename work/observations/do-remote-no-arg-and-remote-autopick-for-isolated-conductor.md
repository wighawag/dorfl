---
title: do --remote should support (a) NO-arg (infer arbiter from cwd → isolate-in-place) and (b) auto-pick/-n over a mirror-side pool — the enablers for an ISOLATED drive-backlog/sub-agent loop; the -n×--remote refusal was an un-surfaced implementation decision
date: 2026-06-07
kind: observation
area: packages/agent-runner/src/cli.ts (do command) + src/do.ts (performDoRemote)
severity: medium
status: open
---

## Where this came from

Designing the `drive-backlog` skill's AUTONOMOUS posture (a sub-agent driving the backlog). A sub-agent shares the human's filesystem/cwd, so building **in-place** risks fighting the human's checkout (and `do` refuses on a dirty tree — they can't both work the same checkout). The natural fix: the sub-agent builds each selected slice in an **isolated job worktree** (the `workspacesDir` area `run`/`do --remote` already use). That surfaced two missing `do --remote` capabilities + one un-surfaced past decision.

> Clarification that shaped this: `drive-backlog` does its OWN intelligent per-slice selection (dependency order + freshness + Gate-3) — it does NOT want `do`'s auto-pick for selection. Auto-pick is `run`'s daemon mechanism. So the need below is NOT "let drive-backlog auto-pick"; it is "let a conductor run a CHOSEN slice in an isolated worktree without a foreign URL", plus the orthogonal observation that remote auto-pick was refused without design review.

## (a) `do --remote` with NO url — infer the arbiter from cwd, isolate-in-place

Today `do --remote <r>` REQUIRES a url/registered spec (`cli.ts`: "`--remote needs exactly one item`" path resolves a URL). There is no way, from inside a repo, to say "build this slice in an ISOLATED worktree off MY arbiter" without re-typing my own remote.

Proposal: make the url OPTIONAL — `do --remote <slug>` (bare flag) infers the arbiter from the current repo's configured arbiter (`origin` / per-repo `defaultArbiter`), materialises a job worktree off THAT (the existing `jobWorktreeStrategy` path), builds there, reaps per §4 — erroring clearly if cwd is not a participating repo. This is the "give me a worktree even though I'm already inside the repo" affordance: it lets a sub-agent (or a human) isolate a build from a dirty/in-use checkout without a foreign URL. (Naming: could also be spelled `do --isolated <slug>` to read as intent rather than "remote"; bikeshed at slice time.)

## (b) auto-pick / `-n` over a mirror-side pool — and the un-surfaced refusal

`do-autopick` made `do`/`do -n <x>`/`do <a> <b>` work over the IN-PLACE checkout's candidate pools (slices + sliceable PRDs). It explicitly REFUSES to combine `-n` with `--remote`:

```
error: -n/--number (auto-pick) is the in-place form; it does not combine with
--remote. Name a single item: `do --remote <r> <slug>`.
```

**This refusal was an inline implementation-time decision, NOT a designed/reviewed one.** Checked both source slices:

- `work/done/do-autopick.md` references `--remote` ONLY as a `cli.ts` **conflict serialiser** ("serialise this after `do-remote` so the two are never built in parallel against the same command block") — it never scoped whether remote auto-pick should exist.
- `work/done/do-remote.md` says nothing about auto-pick / no-arg / `-n` as a follow-up.

So "can you auto-pick remotely?" fell between the two slices and was resolved by the build agent in code, without a question or a noted follow-up. (Process note for the conductor/orchestrate: this is exactly the kind of cross-slice interaction that should surface as a question rather than be settled silently — worth a glance at whether OTHER cross-slice seams were decided inline.)

> SYSTEMIC FIX (2026-06-07): this inline-decision-buried-in-code pattern is now addressed by **`work/backlog/agent-stop-signal.md` Part B/C** — the build agent self-reports non-obvious in-scope decisions in a `## Decisions` block, and the Gate-2 review hunts for un-declared ones. That makes a choice like this `-n`× `--remote` refusal a reviewable artifact instead of silent drift. The feature requests (a)/(b) below are separate from that systemic fix.

The capability itself is real and wanted: a remote/isolated auto-pick would need a **mirror-side pool scan** (enumerate eligible slices + sliceable PRDs from the bare hub mirror's `main`, not the in-place checkout). With (a) + a mirror-side pool, you get `do --remote -n <x>` = "build x eligible items, each in its own isolated worktree, sequentially" — which is the isolated, supervised-conductor counterpart to `run` (run = isolated + parallel + unattended; this = isolated + sequential, driven by a conductor).

## Why it matters / where it connects

- It's the missing primitive behind a safely-ISOLATED `drive-backlog` autonomous (sub-agent) posture — today such a sub-agent must either build in-place (cwd conflict) or call `do --remote <url> <slug>` per slice with a foreign URL.
- It overlaps the **`advance-loop` PRD** (`work/prd/advance-loop.md`): its `run` driver already does isolated + parallel auto-pick; the one-shot/CI `advance` driver may want isolated sequential selection over the same mirror-side pool. So DO NOT build this in isolation — reconcile against advance-loop first (it may subsume (b), and (a) may already fit its substrate).

## Suggested follow-up (not built here)

- (a) `do --remote` no-arg (infer-from-cwd) is a small, self-contained slice — likely safe to slice on its own (the isolate-in-place affordance).
- (b) remote/mirror-side auto-pick is bigger and advance-loop-adjacent — gate it on a check against the advance-loop PRD before slicing, so the mirror-side pool scan is designed once, not twice.
