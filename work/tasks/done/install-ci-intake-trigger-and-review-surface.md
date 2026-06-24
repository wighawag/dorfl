---
title: install-ci intake trigger wiring + author-trust merge policy + issue-thread review surface (capability D + insertion point E)
slug: install-ci-intake-trigger-and-review-surface
prd: runner-in-ci
blockedBy:
  [
    install-ci-core-and-github-adapter,
    intake-per-outcome-integration-modes,
    slicer-review-edit-loop,
    intake-lone-slice-bounded-internal-review,
  ]
covers: [1, 2, 3, 5, 6, 9]
---

## What to build

The `install-ci` capability that wires **issue intake** (capability D) into CI AND surfaces the review verdict back into the issue thread (the review PRD's deferred insertion point E, now owned HERE). It emits the intake workflow from the GitHub adapter, maps GitHub events onto intake's event model, and derives the per-outcome merge-vs-propose flags from the gate state COMPOSED with author trust. The transform engine itself is `issue-intake`'s (Out-of-Scope); CI SCHEDULES `intake`, owns the merge-vs-propose POLICY + author-trust, and delivers the review verdict into the issue thread.

The two design inputs the PRD flagged here are RESOLVED (see Decisions below): author-trust is a simple admin/write-collaborator check with a slice-only `--merge`→`--propose` fallback, and comment-edit resumption is handled by a documented "post a new comment" convention rather than edit-detection. So this slice is buildable.

End-to-end path:

- Emit ONE fixed intake workflow from the GitHub adapter, triggered by `issues` opened, `issue_comment` created, and/or a label. It invokes `intake <N>` (explicit, no bare slug) per the four-outcome dispatch (slice / PRD / ask / bounce) already built.
- Map each GitHub event onto intake's `IntakeEventKind` via the event classifier seam (`classifyIntakeEvent` / `src/intake-event.ts`). We rely on NEW comments (created) to drive (re-)evaluation; an edit of a prior comment is left as the existing `ignore` (see Decision 2), so the ID-based `seen=<ids>` watermark suffices for the CI mapping.
- Derive the per-outcome integration flags CI passes to intake (`--merge-prd`/`--propose-prd`/`--merge-slice`/`--propose-slice` granular + `--merge`/`--propose` aggregate, granular-overrides-aggregate; `intake-per-outcome-integration-modes`, done) from the downstream gate state (`autoSlice`/`autoBuild`) COMPOSED with author trust (Decision 1): an UNTRUSTED author forces `--propose-slice` (slices may never auto-merge from an untrusted issue) but PRDs may still `--merge-prd` (a human-slices-it checkpoint stays ahead of any autonomous action). The fully-gateless "all gates on + `--merge` everywhere" path is a loud, non-default opt-in, never reachable by accident.
- Surface the review verdict into the ISSUE THREAD (insertion point E): run the SAME review/edit loop (`slicer-review-edit-loop` / `intake-lone-slice-bounded-internal-review`, both done) over intake's generated PRD/slices and post the reviewer's findings as questions (and edits where sensible) back into the issue comment thread via the **`IssueProvider.postIssueComment`** seam (keyed by issue **number** — the SAME issue-comment surface `intake` already posts through; `src/issue-provider.ts`), not only into a `work/questions/` file. NOTE the seam distinction (verified against landed code): `postIssueComment` (issue thread, by number) is DISTINCT from `ReviewProvider.postPRComment` (PR comment, by url — what `review-gate-pr-comment` uses); insertion point E posts to the ISSUE, so it uses `postIssueComment`, NOT the PR seam. This ADDS no new review mechanism; it REUSES the built review machinery + the existing issue-comment seam as an issue-front-door delivery surface.
- IN-PLACE in the checkout; per-issue concurrency group; claim CAS as serialiser; the running CI job NEVER edits `.github/workflows/**`.
- Tested by emitting into `--fake` and snapshot/structurally validating the YAML (the event triggers, the derived per-outcome flags incl. the untrusted-author slice fallback, the review-surface posting through a stubbed comment seam); intake's own transform behaviour is already covered and is NOT re-tested.
- **File-orthogonality:** add this capability as a NEW self-registering emitter module via the core's capability-registry seam (from `install-ci-core-and-github-adapter`) — do NOT hand-edit a shared central list/switch, so this slice and the other capability workflow slices (build-tick, advance-lifecycle, intake, close-job) stay mergeable in parallel.

**Gate (agent-buildable):** this slice BUILDS a deterministic generator + a derivation function (author-trust → per-outcome flags), snapshot-tested under `--fake` with a stubbed comment seam (no real issue touched); it does NOT itself land a live workflow, process a real issue, or merge anything (the human runs `install-ci` and commits; US #9 forbids the CI job editing `.github/workflows/**`). The public-front-door merge-trust sensitivity is fully RESOLVED into spec (Decision 1: admin/write-collaborator; untrusted ⇒ `--propose-slice`; fully-gateless = loud non-default opt-in) and is enforced by the generated artifact at runtime, not by agent discretion at build time. So no `humanOnly` (the PRD-level flag does not propagate; the conservative default keeps a human in the loop at run time).

## Decisions (the two PRD design inputs, RESOLVED — were `needsAnswers`, now answered)

1. **AUTHOR-TRUST resolver — keep it simple (admin / write-collaborator).** Trust = the issue author is a repo ADMIN or a WRITE-collaborator; everyone else is untrusted. GitHub's `author_association` on the event payload carries this (`OWNER` / `MEMBER` / `COLLABORATOR` = trusted; `CONTRIBUTOR` / `FIRST_TIME_CONTRIBUTOR` / `NONE` = untrusted) — no extra API call. The composition with the gate is asymmetric by artifact TYPE: an untrusted author makes **slices** fall back `--merge`→`--propose` (i.e. force `--propose-slice` regardless of the `autoBuild` gate), while **PRDs are fine** (`--merge-prd` stays allowed even for an untrusted author, because a human must still slice a PRD before anything autonomous acts on it — the human checkpoint is intact). Trusted author ⇒ the plain gate-derived mode applies to both. This is the resolver; it lives in the CI wiring (the workflow reads `author_association` and sets the per-outcome flags accordingly). The multi-factor matrix the PRD floated (trigger-comment-author × channel × repo-policy) is explicitly NOT adopted — admin/write-collaborator is the whole signal.
2. **Comment-edit resumption — do NOT detect edits; use a "post a new comment" convention.** We accept the existing behaviour that an EDIT of a prior comment is classified `ignore` and that the `seen=<ids>` watermark is ID-based. The product convention (documented in the intake clarifying-question template / issue-thread guidance) is: **if you edit a previous comment, also post a NEW comment noting that you edited it** — the new comment is what drives re-evaluation (a fresh ID the watermark already catches). So the CI event→`IntakeEventKind` mapping only needs to treat `issue_comment` CREATED as the (re-)evaluation trigger; no edit-detection, no `updated_at`/body-hash tracking. (The deeper lock-release lost-update window for a NEW comment landing mid-run is an `issue-intake` ENGINE concern, not a CI-wiring blocker; this slice does not need to fix it to ship — note it and move on.)

## Acceptance criteria

- [ ] `install-ci` emits a single fixed intake workflow triggered by `issues` opened / `issue_comment` created / label, invoking `intake <N>` (explicit, four-outcome dispatch) — never a bare slug.
- [ ] The CI event→`IntakeEventKind` mapping treats a CREATED `issue_comment` as the (re-)evaluation trigger (Decision 2); it does NOT implement edit-detection or `updated_at`/body-hash tracking, and the "post a new comment to signal an edit" convention is documented in the clarifying-question / issue-thread guidance the workflow references.
- [ ] The per-outcome merge-vs-propose flags are DERIVED by CI from the `autoBuild`/`autoSlice` gate state COMPOSED with author trust (Decision 1): trust = `author_association` is `OWNER`/`MEMBER`/`COLLABORATOR`; an UNTRUSTED author forces `--propose-slice` regardless of `autoBuild`, while `--merge-prd` stays allowed (PRDs keep the human-slices-it checkpoint). Trusted author ⇒ the plain gate-derived mode. The fully-gateless path is a loud non-default opt-in.
- [ ] The review verdict over intake's generated PRD/slices is surfaced into the ISSUE THREAD via the `IssueProvider.postIssueComment` seam (issue thread, by number — NOT the PR seam `postPRComment`), reusing `slicer-review-edit-loop` / `intake-lone-slice-bounded-internal-review` — no new review mechanism.
- [ ] The job runs IN-PLACE, carries a per-issue concurrency group, and NEVER edits `.github/workflows/**` (US #9).
- [ ] Tests generate into `--fake` and snapshot/structurally validate the YAML + the derived flags + the issue-thread posting (stubbed comment seam); intake's transform is NOT re-tested. No live Actions run, no network.
- [ ] **Shared-write isolation:** `--fake` writes to `.fake/`, never a real `.github/`; tests assert the real `.github/` + any real secrets store are untouched, and the stubbed comment seam records posts in-memory without touching a real GitHub issue.

## Blocked by

- `install-ci-core-and-github-adapter` — the shared wizard / config / `--fake` / `GitHubCIContext` (incl. issue/comment) seam.
- `intake-per-outcome-integration-modes` — the per-outcome `--merge-*`/`--propose-*` flags CI derives and passes. **In `work/done/` (verified 2026-06-14).**
- `slicer-review-edit-loop` — the review/edit loop reused to review intake's generated artifacts. **In `work/done/`.**
- `intake-lone-slice-bounded-internal-review` — the bounded internal-review loop for a lone intake slice. **In `work/done/`.**

(The two PRD design inputs are RESOLVED in the Decisions section above, so this slice is buildable. The deeper lock-release lost-update window for a NEW comment landing mid-run remains an `issue-intake` ENGINE concern — `work/prd-sliced/issue-intake.md` — not a blocker for shipping this CI wiring.)

## Prompt

> FIRST, check this slice against current reality (it is a launch snapshot and may have DRIFTED): re-read `work/prd/runner-in-ci.md` (capability D row, the "merge-vs-propose POLICY" + "Composed with AUTHOR-TRUST" sections, the "Intake RESUMPTION is edit-blind + lock-lossy" and "Issue-thread review surface" slice-readiness notes) and `work/prd-sliced/issue-intake.md`. CONFIRM the four blockers are in `work/done/` and still expose the surfaces this slice reuses (`intake`'s per-outcome flags; the review/edit loop; the issue-comment seam `IssueProvider.postIssueComment` in `src/issue-provider.ts`). NOTE: `review-gate-pr-comment` posts to PRs via `ReviewProvider.postPRComment` (by url) — that is the WRONG seam for an issue thread; insertion point E posts to the ISSUE via `postIssueComment` (by number). If the seam names have drifted again, re-verify before building. If a blocker landed differently, or an ADR superseded an assumption, route to `needs-attention/` with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RESOLVED DESIGN DECISIONS (the PRD flagged these as open; they are now answered — build to them, do NOT re-open):
> (1) AUTHOR-TRUST = a simple admin / write-collaborator check via GitHub's `author_association` (`OWNER`/`MEMBER`/`COLLABORATOR` = trusted; everyone else untrusted), read from the event payload (no extra API). Composition: an UNTRUSTED author forces `--propose-slice` regardless of the `autoBuild` gate, but `--merge-prd` stays allowed (a human still slices a PRD before anything autonomous acts — the checkpoint is intact). Trusted author ⇒ the plain gate-derived mode for both. Do NOT adopt the multi-factor matrix (trigger-comment-author × channel × repo-policy) — admin/write-collaborator is the whole signal, and it lives in the CI wiring (the workflow reads `author_association` and sets the per-outcome flags).
> (2) COMMENT-EDIT RESUMPTION = no edit-detection. The CI event→`IntakeEventKind` mapping treats a CREATED `issue_comment` as the (re-)evaluation trigger; the ID-based `seen=<ids>` watermark suffices. Document the convention "if you edit a previous comment, post a NEW comment noting the edit" in the clarifying-question / issue-thread guidance — the new comment drives re-evaluation. Do NOT build `updated_at`/body-hash edit tracking. (The lock-release lost-update window for a NEW comment landing mid-run is an `issue-intake` ENGINE concern — `work/prd-sliced/issue-intake.md` — not a blocker for this CI wiring.)
>
> GOAL: emit the intake workflow (capability D) + surface the review verdict into the issue thread (insertion point E). CI SCHEDULES `intake <N>` (four-outcome dispatch), maps a CREATED `issue_comment` onto the (re-)evaluation trigger (Decision 2: new-comment convention, no edit-detection), DERIVES the per-outcome merge-vs-propose flags from gate-state COMPOSED with author-trust (Decision 1: untrusted ⇒ `--propose-slice`, PRDs still mergeable), and posts the review verdict back into the issue thread via the provider comment seam. The transform engine is `issue-intake`'s (Out-of-Scope) — CI only wires/schedules/invokes it and owns the merge policy + delivery surface.
>
> DOMAIN VOCABULARY: per-outcome flags (`--merge-prd`/`--propose-prd`/`--merge-slice`/`--propose-slice` granular + `--merge`/`--propose` aggregate, granular-overrides-aggregate). Resolved per-artifact mode: SLICES — `--propose-slice` if (`autoBuild` gate ON) OR (author untrusted), else `--merge-slice`; PRDs — gate-derived only (`--merge-prd` allowed even for an untrusted author). Fully-gateless = loud non-default opt-in. Insertion point E = reuse the SAME review/edit loop (`slicer-review-edit-loop` / `intake-lone-slice-bounded-internal-review`) and surface findings as QUESTIONS into the ISSUE COMMENT THREAD via `IssueProvider.postIssueComment` (issue thread, keyed by number — the surface `intake` already uses). This is DISTINCT from `ReviewProvider.postPRComment` (PR comment, by url, used by `review-gate-pr-comment`); E posts to the ISSUE, so do NOT use the PR seam. No new review mechanism. CI runs IN-PLACE; per-issue concurrency group; the job NEVER edits `.github/workflows/**` (US #9). Explicit slug prefixes only.
>
> WHERE TO LOOK: the shared core from `install-ci-core-and-github-adapter`; the intake event model (`src/intake-event.ts` `classifyIntakeEvent`, `src/intake-marker.ts` `computeSeenDelta`, `src/intake.ts`); the per-outcome flags (`intake-per-outcome-integration-modes`, done); the review loop (`slicer-review-edit-loop`, `intake-lone-slice-bounded-internal-review`, done); the comment seam (`review-gate-pr-comment`, done); `work/prd-sliced/issue-intake.md` for the engine resumption fix to coordinate with.
>
> SEAMS TO TEST AT: generate into `--fake` with a stubbed `GitHubCIContext` (comment seam records posts in-memory, no real issue touched); snapshot/structurally validate the YAML, the derived per-outcome flags, and the issue-thread posting. No live Actions run, no network. Do NOT re-test intake's transform.
>
> DONE means: the intake workflow + author-trust-composed merge derivation (untrusted ⇒ `--propose-slice`, PRDs still mergeable) + the new-comment-driven event mapping + the issue-thread review surface are emitted and snapshot/structurally validated under `--fake`; and the shared-write isolation assertions pass (real `.github/` + real secrets + real issue untouched). Finish with `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform any git transitions — the runner/human owns those.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim install-ci-intake-trigger-and-review-surface --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/install-ci-intake-trigger-and-review-surface <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/install-ci-intake-trigger-and-review-surface.md work/done/install-ci-intake-trigger-and-review-surface.md
```
