Small cleanup on the recovery-tail invocation of `runFreshWorktreeGate` in `integration-core.ts`. Both changes are cosmetic / documentation only — no behaviour change, no new tests required beyond keeping existing suites green.

Context: the parent task `committed-recovery-honours-fresh-worktree-gate` shipped and Gate 2 approved with two non-blocking nits. The human has ratified both design points; this task lands the resulting touch-ups.

## Scope

### 1. Reason-string verb alignment (the only real code touch)

In the recovery-tail red-gate branch (integration-core.ts ~L1845-1855), the user-visible reason strings currently read:

- `... on the rebased tip during committed-recovery; routed ...`
- `... not integrating ...`

The build-path analogues (~L1322-1330) read:

- `... on the rebased tip; routed ...`
- `... not completing ...`

Change **only** the verb `not integrating` → `not completing` on the recovery path, to match the build-path verb. The verb swap in the original PR was unmotivated drift.

**Keep** the `during committed-recovery` distinguisher in the other string — it is a deliberate operator signal in needs-attention output telling which path (build vs. recovery-tail) failed the fresh-worktree gate. Do NOT strip it.

### 2. Document the review-callback omission (one-line comment)

At the recovery-tail `runFreshWorktreeGate` call site (integration-core.ts ~L1815-1830), the build path passes `review:` when `input.review` is set; the recovery-tail path deliberately does not. This is the right permanent design: answered-merge / committed-recovery land is re-verifying an already-reviewed, already-committed result, so there are no Gate-2 review semantics to thread.

Add a one-line code comment at that call site making the intent explicit, e.g.:

```ts
// No `review:` callback here: the recovery tail re-verifies an already-reviewed,
// already-committed result, so Gate-2 review semantics do not apply on this path.
```

Exact wording is at author discretion; the requirement is that a future reader diffing recovery vs. build paths sees immediately that the omission is intentional, not an oversight.

## Out of scope

- Threading `input.review` through the recovery tail (explicitly rejected — see comment above).
- Aligning the `during committed-recovery` phrase away (explicitly kept).
- Any change to the build-path strings.
- Any test additions; if a snapshot/string-assertion test pins the old `not integrating` verb, update it in the same commit.

## Acceptance

- `integration-core.ts` recovery-tail reason string uses `not completing` (matching build path); `during committed-recovery` distinguisher preserved.
- A short comment at the recovery-tail `runFreshWorktreeGate` call site explains why no `review:` callback is passed.
- `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Provenance

Derived from observation `review-nits-committed-recovery-honours-fresh-worktree-gate-2026-06-26` (Gate-2 non-blocking nits, both ratified by the human on 2026-07-07). That observation can be deleted once this task is minted — its content is fully carried here.

## Prompt

> Build the task 'recovery-tail-fresh-worktree-gate-nit-cleanup', described above.
