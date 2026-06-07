---
title: slicer-review-edit-loop — the review→edit→re-review→converge loop on the `do prd:` slicing path (Shape 2 / insertion point A); reject-as-needsAnswers on maxReview
slug: slicer-review-edit-loop
prd: review
blockedBy: [autoslice-command]
covers: [1, 2, 6]
---

## What to build

The **slicer edit loop** (RESOLVED DESIGN in `work/prd/review.md`, Shape 2 /
insertion point A): after the `do prd:<slug>` path produces a candidate set of
slices, run the `review` skill as a **review→EDIT→re-review→converge** loop that
improves the slices in place, then routes the final verdict through the existing
needsAnswers / needs-attention sink. This is NOT a one-shot gate — it is an
IMPROVER, because slices measurably keep getting better when reviewed (the
empirical finding behind the `review` PRD + its idea file).

### The loop (resolved mechanism)

- **One agent reviews AND edits in a SINGLE context** (the N in-context multipass):
  run the `review` skill's ordered adversarial lenses **ending in the
  destination/goal check** (the goal check is part of the same pass and may ITSELF
  trigger edits — that is why it is a loop), apply the resulting edits to the
  candidate slice files, then re-review. Passes accumulate (each sees prior
  findings + the edited slices). De-correlation by ANGLE within the context.
- **A fresh context is simply a NEW EXECUTION of that same loop in a fresh context**
  (the M): the M×N grid = run the (review+edit) loop N passes deep, M times in
  fresh contexts. `M=1,N=…` is the cheap default; `M=k` runs k independent fresh
  loops. Implement the loop ONCE; M is just invoking it again with a fresh harness
  launch (fresh context = a separate launch, like the Gate-2 reviewer).
- **The `review` skill is REUSED** (`skills/review/SKILL.md`, built) — this slice
  wires the loop + edit-application + routing around it; it does NOT re-author the
  protocol. The lenses + destination check live in the skill.

### Termination + verdict routing (the sink)

- **Natural terminator:** a pass finds NO NEW blocking issue (passes taper to zero
  — the observed behaviour). Then the slices are accepted (land claimable).
- **Hard cap `maxReview`** (per-repo configurable: flag > env > per-repo > global,
  cheap default e.g. 3): on reaching it with unresolved blockers, **REJECT** —
  route via the EXISTING needsAnswers / needs-attention sink:
  - a specific uncertain slice → emit it with `needsAnswers: true` + the questions
    in its body (created, not agent-buildable until a human answers); OR
  - the whole decomposition still unclear / cap hit broadly → route the PRD to
    `work/needs-attention/<slug>.md` with the questions as the reason, emitting no
    guessed slices.
  This routing is OWNED by this slice (folded in from the former
  `autoslice-confidence`, now deleted — see the section below). `maxReview` lives on
  the LOOP, never on a gate.

### This slice OWNS the verdict routing (folded in from the former `autoslice-confidence`)

The needsAnswers / needs-attention routing is PART OF this slice — it is the loop's
verdict sink and is what makes the three OUTCOMES coherent in one place:
- converge (no new blocking issue) → the improved slices land claimable;
- a specific uncertain slice → emit it `needsAnswers: true` + questions in its body;
- the whole decomposition unclear / `maxReview` exhausted → route the PRD to
  `work/needs-attention/<slug>.md` with the questions, emit no guessed slices.

This routing was previously planned as a separate `autoslice-confidence` slice.
That slice has been **DELETED** (decision B, 2026-06-06, at slice-authoring time):
its one-shot self-confidence JUDGEMENT is superseded by this loop, and its routing
is FOLDED IN here. The 4 references to it have already been reconciled to point at
this slice. **The implementer does NOT touch any sibling slice or PRD** — that
reconciliation is already done; this slice is PURE CODE (the loop + the routing).
There is no `autoslice-confidence` slice to build, depend on, or edit.

### Scope fence

- IN: the review→edit→converge loop on the `do prd:` path; M×N (one loop, fresh
  re-execution for M); the `maxReview` cap + reject-as-needsAnswers / route-PRD-to-
  needs-attention sink; reusing the `review` skill; the per-repo `maxReview` config.
- OUT: the review GATE shapes (impl post-build = built #11/#12; pre-build slice
  check = later set B); run coverage (later set D — converge run on `do` first);
  issue-thread surfacing (later set E); removing `reviewMaxRounds` from the Gate-2
  path (separate cleanup). NOT a new slicing path — it plugs into `do prd:`
  (autoslice-command).

## Acceptance criteria

- [ ] After `do prd:<slug>` produces candidate slices, the loop runs the `review`
      skill, APPLIES its edits to the candidate slice files, and re-reviews, until a
      pass finds no new blocking issue (then the improved slices land) OR `maxReview`
      is hit.
- [ ] The destination/goal check runs as part of the loop's review pass (not a
      separate terminal step) and its findings can trigger edits like any other.
- [ ] M fresh-context executions: with M>1, the loop is run M times in fresh
      harness launches; degenerate M=1 is one loop. N is the in-context pass depth.
- [ ] `maxReview` cap reached with unresolved blockers ⇒ REJECT via the existing
      sink: a specific uncertain slice emitted `needsAnswers: true` + questions; or
      the PRD routed to `needs-attention/` with the reason, emitting no guessed
      slices. Never an infinite loop; never a silently mis-sliced PRD.
- [ ] `maxReview` resolves per-repo (flag > env > per-repo > global > cheap
      default); the loop default is on for auto-slicing (no `verify` floor exists
      there), human path unaffected.
- [ ] The `review` skill is REUSED (no re-authored protocol); the loop wires
      edit-application + routing around it.
- [ ] The verdict routing (folded in from the deleted `autoslice-confidence`) is
      implemented HERE as the loop's sink — the three outcomes above. (No sibling
      slice/PRD edits: that reconciliation was done at slice-authoring time.)
- [ ] Tests (stub the review agent's verdict + edits; stub the harness; temp dirs):
      a converging loop (findings → edits → clean) lands improved slices; a
      persistent-block loop hits `maxReview` and rejects via needsAnswers /
      PRD→needs-attention; M>1 invokes the loop in fresh contexts; the human path is
      unaffected. No real model, no network.
- [ ] **Test isolation (shared-write rule):** any slice-file writes happen under a
      temp work tree; the real `~/.agent-runner/` + `~/.pi/agent/sessions/` are
      UNTOUCHED (reuse `isolatePiAgentDir`).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `autoslice-command` — the `do prd:<slug>` slicing path this loop plugs INTO (it
  improves the candidate slices that path produces). That slice itself is blocked
  by `autoslice-gate`, `autoslice-lock`, `do-in-place`, so this loop is downstream
  of the auto-slice chain. (NOT blocked by the Gate-2 work — different shape; but it
  REUSES the same `review` skill, already built.)

## Prompt

> Build the **slicer review→edit→converge LOOP** on the `do prd:<slug>` path, per
> `work/prd/review.md` RESOLVED DESIGN (Shape 2 / insertion point A) and
> `work/findings/review-gate-vs-slicer-edit-loop.md`. This is an IMPROVER, NOT a
> one-shot gate: review the candidate slices, APPLY the findings as edits,
> re-review, converge — with the destination/goal check inside the loop (it can
> trigger edits). REUSE the `review` skill (`skills/review/SKILL.md`, built); do NOT
> re-author the protocol.
>
> FIRST run the drift check: confirm `autoslice-command` built the `do prd:<slug>`
> slicing orchestration (read its done file + the module behind `do`'s `prd:`
> dispatch) — you plug the loop in AFTER candidate slices are produced, BEFORE they
> are finalised/landed. Confirm the needsAnswers / needs-attention routing exists
> (the `autoslice-confidence` spec + `src/needs-attention.ts` + the
> `ledger-write-seam-needs-attention` done file) — you REUSE it as the loop's
> verdict sink. Route this slice to needs-attention on any real discrepancy.
>
> Implement: the single-context review+edit loop (run the skill's lenses + goal
> check, apply edits to the candidate slice files, re-review until no NEW blocking
> issue); M fresh-context re-executions (a new harness launch per M); the
> `maxReview` hard cap (per-repo config, flag>env>per-repo>global, cheap default);
> on cap-with-blockers REJECT via the existing sink (specific slice → needsAnswers +
> questions; whole decomposition → PRD to needs-attention, no guessed slices). The
> agent makes the review/edit JUDGEMENTS; you wire the loop + edit-application +
> routing. The human slicing path is unaffected.
>
> The verdict routing is PART OF this slice (folded in from the former
> `autoslice-confidence`, now DELETED — decision B). Implement the routing HERE as
> the loop's sink (the three outcomes). Do NOT touch any sibling slice or PRD — the
> reference reconciliation was already done at slice-authoring time; this slice is
> pure code. There is no `autoslice-confidence` slice.
>
> READ FIRST: `skills/review/SKILL.md` (the protocol to RUN — lenses + destination
> check + the M×N / "second instance is a signal" disciplines); `work/prd/review.md`
> RESOLVED DESIGN; `work/backlog/autoslice-command.md` + its module (the `do prd:`
> path); `src/needs-attention.ts` + `ledger-write-seam-needs-attention` (the sink);
> `src/repo-config.ts` + `src/config.ts` (the per-repo precedence for `maxReview`);
> `src/harness.ts` (`LaunchInput`/`launch` — a fresh context per M is a fresh
> launch; `LaunchResult.output` carries the agent's verdict, slice
> `harness-agent-output`).
>
> TDD with vitest, house style (stub the review agent's verdict+edits, stub harness,
> temp work tree, `isolatePiAgentDir`): converging loop lands improved slices;
> persistent-block hits `maxReview` → reject via needsAnswers / PRD→needs-attention;
> M>1 fresh re-executions; human path unaffected; real `~/.agent-runner/` +
> `~/.pi/agent/sessions/` untouched. "Done" = acceptance criteria met and the gate
> green.

---

### Claiming this slice

```sh
agent-runner claim slicer-review-edit-loop --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/slicer-review-edit-loop <remote>/main
git mv work/in-progress/slicer-review-edit-loop.md work/done/slicer-review-edit-loop.md
```
