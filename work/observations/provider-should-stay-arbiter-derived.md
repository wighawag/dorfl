---
title: provider is (and should stay) arbiter-derived — the `provider: github` force-override is the one config axis that contradicts the arbiter
date: 2026-06-06
status: open
---

## The signal

While checking whether `do` needs a `--provider` flag, the maintainer noted: **"the provider is dependent on the arbiter, so we should never have it [as an independent choice]."** Checking the code, that intuition is correct by design — but with one nuance worth recording before any cleanup.

`selectProvider` (`src/github.ts`) already DERIVES the review-request provider from the arbiter URL when no override is set:

```
no override → arbiter is a GitHub URL ? GitHubProvider : NoneProvider
```

So in the normal case the provider IS a function of the arbiter (`--arbiter`), not an independent axis. That is why there is correctly **no `--provider` flag on `do`**: adding one would invite the contradictory state "GitHub provider + local arbiter."

## The nuance: the explicit `provider` config does TWO different jobs

1. **`provider: none` — "push only, do NOT open a PR even on a GitHub arbiter."** This is a legitimate POLICY choice, NOT derivable from the arbiter (you can have a GitHub arbiter and still want pushed-branches-only). Keep it.
2. **`provider: github` — "force the GitHub provider even on a non-GitHub arbiter."** THIS is the axis that contradicts the maintainer's point: it is a config state that disagrees with the arbiter. It is not catastrophic (the GitHub provider is built to "never hard-fail" — it degrades to manual-PR instructions rather than throwing), but it can never actually do anything useful against a non-GitHub arbiter. It exists only as a manual escape hatch.

## Disposition (for a future provider/arbiter-coupling review — do NOT act now)

- **Keep provider arbiter-DERIVED by default** (the current `selectProvider` behaviour) and do NOT add a `--provider` flag to `do`/`complete` — the arbiter determines it.
- **Keep `provider: none`** — it is an orthogonal "suppress PRs" policy, not an arbiter contradiction.
- **Review whether `provider: github` (force) earns its weight** — it is the one config value that can contradict the arbiter. Options for a future pass: drop it (rely purely on derivation + `none`), or keep it strictly as a documented graceful-degradation escape hatch. Decide deliberately; it should not silently remain an independent axis.

(Captured 2026-06-06 during the review-gate / `do` CLI-flag discussion. No flag is needed; this is an architecture note about the provider⟸arbiter coupling, not a missing feature.)
