---
title: Direct-delete CLI helper — drop a source + its sidecar in one revertible commit
slug: direct-delete-question-cli-helper
prd: agentic-question-resolution-retire-disposition-vocabulary
blockedBy: [agentic-apply-retire-disposition-vocabulary]
covers: [5, 11]
---

## What to build

A small, explicit `dorfl` verb that DELETES a source item + its question sidecar
DIRECTLY — the "throw it away outright" path that does NOT round-trip through the
decision engine. A thin vertical path through CLI + logic + tests:

- **The verb.** A one-line helper (e.g. `dorfl drop <slug>` / a question-rm verb)
  that `git rm`s the source item AND its sidecar (when present) in ONE commit, with
  the reason recorded in the commit MESSAGE (git history is the archive). Resolve
  the source by its namespaced identity (`task:` / `prd:` / `obs:` / bare).
- **Revertible.** The deletion is a SINGLE revertible commit — a wrong delete is
  never catastrophic (US #11). Reason in the commit message.
- **No engine round-trip.** This is the human/skill direct action (US #5): the
  human, the `answer-questions` skill, or this CLI just deletes. It is SEPARATE from
  the agent reaching `delete-source` as a verdict (that path is the keystone task).

Note: the existing `dorfl rm` is the hub-MIRROR deleter (`remote rm`) — this is a
genuinely new, unrelated verb. Pick a name that does not collide.

## Acceptance criteria

- [ ] A `dorfl` verb deletes a named source item + its sidecar (when present) in
      ONE commit, with the reason in the commit message.
- [ ] The source is resolved by its namespaced identity (task / prd / observation /
      bare slug).
- [ ] The deletion is a single revertible commit (a wrong delete is recoverable via
      git).
- [ ] The verb does NOT round-trip through the decision engine (it is the direct
      human/skill/CLI path).
- [ ] A CLI test over a THROWAWAY repo proves source + sidecar removed in one
      revertible commit, reason in the message.
- [ ] Tests ISOLATE their work in throwaway repos; no shared/global location is
      written.

## Blocked by

- `agentic-apply-retire-disposition-vocabulary` — this verb reuses
  `resolveItemPathByIdentity` (the by-identity source-path resolver), which the
  keystone EXTRACTS from `apply-persist.ts` into a neutral module + re-exports from
  the package index. Depending on the keystone means this task imports the resolver
  from its stable home, not from the hot file the keystone is rewriting (avoids a
  stale-read coupling). The verb writes only new CLI/module files, so it is
  WRITE-orthogonal — the dependency is a READ dependency on the extracted seam.

## Prompt

> Add a small explicit `dorfl` CLI verb that DELETES a source item + its question
> sidecar directly — the "I just want to throw this away" path that does NOT
> round-trip through the decision engine. This is US #5/#11 of the source PRD: a
> direct human/skill/CLI delete, git-recoverable.
>
> Domain vocabulary + where to look: a question SIDECAR is `work/questions/<type>-<slug>.md`,
> keyed on the source item's namespaced `(type, slug)` identity (reuse the sidecar
> module's `sidecarPathFor` / `resolveSidecarIdentity` to find it). The source item
> rests in one of its lifecycle folders. REUSE the by-identity path resolver
> `resolveItemPathByIdentity` — the keystone task
> `agentic-apply-retire-disposition-vocabulary` (your blocker) extracts it from
> `apply-persist.ts` into a NEUTRAL module and re-exports it from the package index,
> so import it from THERE (not from `apply-persist.ts`). If the keystone has not
> actually landed that extraction, treat it as drift (below). The verb `git rm`s BOTH the
> source and the sidecar (when the sidecar is present) in ONE commit, with the
> human's reason recorded in the commit MESSAGE (git history is the archive). Wire
> it into the CLI alongside the other verbs (see `cli.ts` for the `.command(...)`
> pattern). IMPORTANT: the existing `dorfl rm` is the hub-MIRROR deleter
> (`remote rm`) — this is a different, unrelated verb, so choose a name that does
> not collide (e.g. `drop <slug>` or a question-specific rm).
>
> Boundaries: this is the DIRECT path only — it must NOT invoke the decision engine
> or any agent. (The agent reaching `delete-source` as a verdict is the keystone
> task `agentic-apply-retire-disposition-vocabulary`, separate from this.) The
> deletion must be a SINGLE revertible commit so a wrong delete is never
> catastrophic.
>
> "Done": the verb deletes a named source + its sidecar in one revertible commit
> with the reason in the message, with a CLI test over a throwaway repo proving it.
> Acceptance: `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm the sidecar path/identity helpers are still as described,
> that the keystone landed the `resolveItemPathByIdentity` extraction into a neutral
> re-exported module (import it from THERE), and that no `dorfl drop`/question-rm
> verb already exists. If a dependency landed differently or an ADR superseded an
> assumption here, do NOT build on the stale premise — route the task to
> needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a
> needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building (the verb name, how
> the reason is supplied, behaviour when the sidecar is absent or the source does
> not resolve). If a choice meets the ADR gate (hard to reverse + surprising
> without context + a real trade-off), write the WHY as an ADR in `docs/adr/`;
> otherwise note it briefly in the done record / PR description. An un-recorded
> in-scope decision is a review FINDING, not a silent default.

---

### Claiming this task

```sh
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/<slug>.md work/tasks/done/<slug>.md
```
