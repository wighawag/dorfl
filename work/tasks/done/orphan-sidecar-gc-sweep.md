---
title: Orphan-sidecar gc sweep — reap a question whose source is gone
slug: orphan-sidecar-gc-sweep
spec: agentic-question-resolution-retire-disposition-vocabulary
blockedBy: [agentic-apply-retire-disposition-vocabulary]
covers: [10]
---

## What to build

A SWEEP over `work/questions/` that reaps an ORPHANED question sidecar — one whose
source item no longer exists (deleted out-of-band, per the contract that notes
leave by deletion) — folded into `dorfl gc` so it runs on the scheduled CI tick. A
thin vertical path:

- **Why a sweep, not an apply step.** An orphan's source item is GONE, so it is in
  NO lifecycle pool; the advance driver enumerates ITEMS, never orphaned sidecars,
  so no per-item `advance` tick (`apply`/`no-op`) ever runs on it. The orphan's only
  on-disk trace is the sidecar file itself. Therefore the reap MUST enumerate
  `work/questions/` directly — a sweep — not a per-item rung.
- **Detect + reap.** For each `work/questions/<type>-<slug>.md`, resolve its
  `(type, slug)` identity and check whether the source item exists (reuse the
  keystone's extracted `resolveItemPathByIdentity` — the by-identity source-path
  resolver, working-tree based over the lifecycle folders). Absent source ⇒ orphan
  ⇒ `git rm` the sidecar. A sidecar whose source EXISTS is left untouched.
- **Home it in `dorfl gc` AND make it fire in CI.** `dorfl gc` today reaps job
  worktrees (and `--remote-branches` reaps merged branches). Add the orphan-sidecar
  pass to `gc` so that the invocation the SCHEDULED CI lifecycle workflow runs
  actually triggers it. The scheduled reap step runs exactly
  `dorfl gc --remote-branches --arbiter origin` (see the advance-lifecycle CI
  template), so EITHER make the orphan pass part of the always-run `gc` body
  (fires regardless of flags) OR extend the `--remote-branches` path / the CI
  template's reap step to invoke it. Do NOT leave it behind a flag the scheduled
  job never passes (that is "in the code but never invoked"). Add/extend a template
  assertion proving the scheduled gc invocation reaps orphan sidecars.

Working-tree based: the sweep operates on whatever checkout `gc` runs in (CI checks
out the repo); no separate arbiter ref query is needed beyond the existence check.

## Acceptance criteria

- [ ] A `gc` sweep reaps a `work/questions/<type>-<slug>.md` whose `(type, slug)`
      source item is absent (working-tree existence via the extracted
      `resolveItemPathByIdentity`); a sidecar whose source exists is LEFT untouched.
- [ ] The reap is a `git rm` (notes/sidecars leave by deletion; git history is the
      archive), with the orphan slug(s) reported.
- [ ] The orphan pass actually FIRES under the invocation the scheduled CI
      lifecycle workflow runs (`dorfl gc --remote-branches --arbiter origin`) — not
      gated behind an un-passed flag. A template/structural assertion proves it.
- [ ] Reuses the keystone's extracted `resolveItemPathByIdentity` (imported from the
      neutral re-exported module, not from `apply-persist.ts`).
- [ ] Tests cover both cases (source gone ⇒ reaped; source present ⇒ left) over a
      throwaway repo, in the repo's existing `gc` test style.
- [ ] Tests ISOLATE their work in throwaway repos and assert no shared/global
      location is touched.

## Blocked by

- `agentic-apply-retire-disposition-vocabulary` — this sweep reuses the
  `resolveItemPathByIdentity` resolver the keystone EXTRACTS from `apply-persist.ts`
  into a neutral re-exported module. The dependency is a READ dependency on that
  extracted seam; the sweep itself edits `gc.ts` / the gc command / the CI template
  (write-orthogonal to the keystone's files — no other backlog task edits `gc.ts`).

## Prompt

> Build an ORPHAN-SIDECAR gc SWEEP for dorfl and fold it into `dorfl gc` so it runs
> on the scheduled CI tick. A question sidecar is a tooling-owned file
> `work/questions/<type>-<slug>.md` keyed on its source item's `(type, slug)`
> identity. When a human deletes the source observation out-of-band (notes leave by
> deletion, per the work contract), the sidecar is orphaned.
>
> WHY THIS IS A SWEEP, NOT AN APPLY STEP (read this — it is the whole reason the
> task is shaped this way): an orphan's source item is GONE, so it is in NO
> lifecycle pool. The advance driver enumerates ITEMS in the pools (tasks / prds /
> observations) and looks up THEIR sidecars; it never enumerates orphaned sidecars.
> So no per-item `advance` tick ever runs on an orphan — neither the `apply` rung
> nor a `no-op` is ever reached for it (the classifier never sees it). The orphan's
> only on-disk trace is the sidecar file. Therefore the reap MUST enumerate
> `work/questions/` directly. Do NOT try to hook this into the apply rung / the
> classifier / a `no-op`→delete change — all of those require the item to be
> enumerated, which a deleted-source orphan never is.
>
> Where to look:
> - The sidecar module owns path/identity resolution (`sidecarPathFor` /
>   `resolveSidecarIdentity`) — reuse it to derive each sidecar's `(type, slug)`.
> - The keystone task `agentic-apply-retire-disposition-vocabulary` (your blocker)
>   EXTRACTS `resolveItemPathByIdentity` (the by-identity "does the source item
>   exist?" resolver, working-tree based over the lifecycle folders) into a NEUTRAL
>   re-exported module. Import it from THERE and use it as the existence check.
> - `gc.ts` + the `gc` CLI command: `gc` today reaps job worktrees;
>   `--remote-branches` reaps merged branches. Add the orphan-sidecar pass here.
> - The scheduled CI reap step (advance-lifecycle CI template) runs EXACTLY
>   `dorfl gc --remote-branches --arbiter origin`. Your orphan pass MUST fire under
>   THAT invocation — either make it part of the always-run `gc` body (fires
>   regardless of flags) or wire it into the `--remote-branches` path / update the
>   template's reap step. Add or extend a template assertion proving the scheduled
>   invocation reaps orphan sidecars, so this does not become "in the code but never
>   invoked in CI" (the exact trap this task exists to avoid).
>
> Behaviour: for each sidecar under `work/questions/`, if its source item is ABSENT
> (working-tree existence via `resolveItemPathByIdentity`), `git rm` the sidecar and
> report it; if the source EXISTS, leave it.
>
> "Done": `dorfl gc` reaps orphaned sidecars and leaves live ones, the orphan pass
> provably fires under the scheduled CI gc invocation, with tests covering both
> cases over a throwaway repo. Acceptance:
> `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm sidecars are still identity-keyed under `work/questions/`,
> that "notes leave by deletion" still holds, that the keystone landed the
> `resolveItemPathByIdentity` extraction into a neutral re-exported module (import
> from THERE), and that the scheduled CI reap step still runs
> `dorfl gc --remote-branches`. If a dependency landed differently or an ADR
> superseded an assumption here, do NOT build on the stale premise — route the task
> to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is
> a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building (whether the orphan
> pass rides the always-run `gc` body or the `--remote-branches` path, how the CI
> assertion is shaped, any flag gating). If a choice meets the ADR gate (hard to
> reverse + surprising without context + a real trade-off), write the WHY as an ADR
> in `docs/adr/`; otherwise note it briefly in the done record / PR description. An
> un-recorded in-scope decision is a review FINDING, not a silent default.

---

### Claiming this task

```sh
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/<slug>.md work/tasks/done/<slug>.md
```
