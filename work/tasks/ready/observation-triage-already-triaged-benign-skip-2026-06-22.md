## Problem

On every `advance-lifecycle` tick, the triage leg for an observation whose task ALREADY EXISTS re-runs `promote obs:<slug>`, re-loses the create CAS on `work/tasks/todo/<slug>.md`, and exits 2 — reddening CI forever until a human deletes/edits the observation. The current code path (see `src/advancing-lock.ts:527` / `:544`) has only ONE 'lost the create race — back off, left unresolved for a retry' branch, so it cannot tell:

- (A) TERMINAL: a task minted FROM this observation already exists on `<arbiter>/main` — the observation was already triaged in a prior run. Retry can NEVER succeed.
- (B) TRANSIENT: two ticks genuinely raced to mint the same NEW task at once. Retry is the right response.

Same CI-noise family as the sibling stale-snapshot and held-lock observations — trains the operator to ignore red.

Provenance:
- `.github/workflows/advance-lifecycle.yml` (`enumerate` → `lifecycle.triage[]` → `advance "obs:<slug>" --propose` legs)
- `src/advancing-lock.ts:527` (the single 'lost the create race (or the slug is taken). Back off.' branch that conflates A and B)
- `src/lifecycle-gather.ts` (`gatherLifecycleInPlace`) and `src/lifecycle-pools.ts` (`buildLifecyclePools`, triage sub-pool) — where the observation is (re-)enumerated as untriaged
- Live example: observation `integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21` with an existing `work/tasks/todo/integratelock-...-2026-06-21.md` + `work/questions/task-integratelock-...-2026-06-21.md` sidecar
- Sibling CI-noise observations: `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`, `work/notes/observations/advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick-2026-06-22.md`

## Scope (from the answered scoping)

Answered up-front by the human on the source observation — carry these as decisions, not open questions:

1. **Detection mechanism: derive from the minted task's existence, NOT a new frontmatter marker.** Do NOT reintroduce a `triaged: promoted` / `triaged: keep` frontmatter marker on the observation. The in-flight task `observation-discharge-by-deletion-self-contained-promotion-and-prd-route` is actively RETIRING the `triaged:` resting-state convention in favour of discharge-by-deletion; a new marker mechanism here would fight that direction. Instead, at the create-CAS step (and/or at gather time), detect that a task provably minted FROM this observation already exists ANYWHERE on `<arbiter>/main` (`tasks/todo|backlog|done|cancelled/`) — via slug derivation and/or an explicit back-reference from the task to the observation — and treat that as terminal 'already triaged'.

2. **Auto-disposition: benign skip, no human prompt.** When (and ONLY when) the minting task is PROVABLY the one minted from this observation, auto-treat as already-triaged. This is an idempotency fact — the human already decided when they minted the task — not a judgement call, so it clears the conservative no-question auto-disposition bar. Anything short of a provable observation→task link stays loud (exit 2).

3. **Exit-code / skip semantics: reuse the benign-skip outcome shape from the observation-identity slice** (exit 0 / a tolerated non-error outcome the `advance-lifecycle` matrix accepts) for the already-triaged case, so this lands consistent with the sibling already-done / held-lock CI-noise fixes. Keep the LOUD exit 2 only for a genuine concurrent-create race (case B above), where a retry actually helps.

4. **Dependency / sequencing (IMPORTANT):** This task is dependent on / must be sequenced with the discharge-by-deletion task `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`. Once observations are discharged-by-deletion after tasking, the source observation file is simply GONE and cannot re-fire — which may make the derivation logic here trivial (or partly unnecessary) for the freshly-triaged path, leaving this fix as a backstop for legacy/pre-existing observations that were triaged before discharge-by-deletion landed, plus the true concurrent-race case. Reconcile against the final shape of that work before implementing: do not duplicate its guarantees, but do cover the residual cases it does not.

## Deliverables

- Teach the create-CAS site in `src/advancing-lock.ts` (around the `:527`/`:544` 'lost the create race' branch) to distinguish case A (terminal 'already triaged' — the existing task is provably the one this observation would mint) from case B (transient concurrent-create race).
- On case A: emit the benign-skip outcome (exit 0 / tolerated matrix outcome, same shape as the observation-identity slice's already-done skip), with a message that is honest about the situation being terminal-by-existence, NOT 'left unresolved for a retry'.
- On case B: keep the current loud back-off / exit 2 behaviour.
- Decide and implement the provable-link check: slug derivation from the observation, and/or an explicit back-reference field on the minted task pointing at the source observation. Whichever mechanism is chosen, document it inline and make it robust to observations sharing a slug prefix.
- Optionally, have `buildLifecyclePools` / `gatherLifecycleInPlace` exclude observations whose minted task provably exists, so they never enter the triage pool in the first place (belt-and-braces with the CAS-site check). Only worth doing if it does not overlap with what discharge-by-deletion already achieves.
- Cover with tests: (i) observation whose task already exists on `main` → benign skip, exit 0, no red CI; (ii) two ticks racing to mint the same NEW task → one wins, the loser exits 2 as today; (iii) unrelated task sharing a similar slug does NOT trigger the benign-skip false positive.
- Update / cross-reference the sibling CI-noise observations so the family lands consistently.

## Non-goals

- Not a correctness fix (the CAS correctly refuses the duplicate — no double-mint risk); this is purely an idempotency / CI-noise fix.
- Do NOT add a `triaged:` frontmatter marker to observations (explicitly rejected above; conflicts with discharge-by-deletion).
- Do not redesign the triage pool or the observation lifecycle beyond what is needed to stop the re-fire.

## Acceptance

- `pnpm -r build && pnpm -r test && pnpm format:check` green.
- The reproducer (an observation with an existing minted task on `<arbiter>/main`) no longer reds CI on `advance-lifecycle` ticks; its triage leg exits benignly with an honest message.
- A genuine concurrent-create race still fails loudly with exit 2 on the losing tick.
- Sequencing with `observation-discharge-by-deletion-self-contained-promotion-and-prd-route` is stated in the task's own notes and honoured in the implementation order.