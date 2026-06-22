<!-- agent-runner-sidecar: item=brief:land-time-reverify-and-parallel-merge-ceiling type=brief slug=land-time-reverify-and-parallel-merge-ceiling allAnswered=false -->

## Q1

**Cross-job merge serialiser for parallel merge in CI — git-alone floor + optional accelerator?**

> Open Question 1. The in-memory `integrateLock` does not span CI jobs; only the CAS loop (`DEFAULT_MERGE_RETRIES = 5`, sized for in-process siblings) serialises across jobs. A wide matrix burst risks bouncing losers to needs-attention. Options: (a) just SCALE `mergeRetries` to expected matrix width (simple, git-alone, but burst past cap still bounces); (b) a cross-job concurrency group / ref-based land-lock so losers QUEUE rather than retry-then-bounce; (c) GitHub Actions `concurrency:` on the merge job (host-specific — violates the git-alone-floor framing for the SERIALISER itself). The brief itself flags 'likely (a) as the git-alone floor + (b) or (c) as an optional accelerator — confirm.'

_Suggested default: (a) scaled `mergeRetries` as the git-alone floor + (b) a ref-based cross-job land-lock as the portable accelerator (preferred over (c) so the accelerator is not GitHub-only); (c) remains available where the host offers it._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

**Confirmed: (a) scaled `mergeRetries` as the git-alone FLOOR + (b) a ref-based cross-job land-lock as the portable ACCELERATOR. (c) GitHub `concurrency:` is allowed only as a host-specific convenience ON TOP, never as the serialiser the floor depends on.**

The brief's own framing forces this: the git-alone floor must be safe with nothing but `git push` + ref CAS against a bare arbiter, so the SERIALISER that guarantees correctness cannot be a GitHub-Actions feature. That rules (c) OUT as the floor. (a) is already the de-facto floor (the CAS loop IS the cross-job queue per story #5), so the only real decision is whether to ADD (b), and the answer is yes-but-carefully:

- **(a) is correctness-sufficient but throughput-poor under a burst.** `DEFAULT_MERGE_RETRIES = 5` was sized for in-process siblings. Past the cap a loser bounces to needs-attention — a SPURIOUS bounce (the work is fine; it just lost the race too many times). So (a) alone trades a real-but-bounded correctness floor for noisy false-positive attention under wide matrices.
- **Scale the cap, do not just leave it at 5.** Make `mergeRetries` resolve through the same precedence chain as the gate family (flag > env > per-repo > global > default) so a wide-matrix CI can raise it; keep the default modest. Crucially: a lost CAS must cost only a re-rebase + re-gate RETRY, never a `--force` and never a both-land-broken — which the engine already guarantees. Scaling the cap only changes WHEN a genuinely-stuck loser gives up, not the safety.
- **(b) the accelerator: a ref-based land-lock (e.g. CAS-claim a `refs/agent-runner/land-lock` sentinel ref) so losers QUEUE/back-off rather than burn retries then bounce.** Portable (pure ref CAS, works against a bare arbiter), so it does NOT violate the floor framing the way (c) would. This is the cross-job analogue of the in-process `integrateLock`. Prefer it over (c) precisely so the accelerator degrades to every host, with GitHub merely faster, not required.
- **Guard against a stale land-lock.** A ref-lock held by a crashed job must be reclaimable (a TTL / staleness check, mirroring how the per-item lock reaper treats stale locks) or it becomes a self-inflicted deadlock that is strictly worse than (a)'s bounce. If a robust stale-lock story is not cheap, ship (a) scaled NOW and split (b) into a follow-on slice rather than ship a deadlock-prone lock.

Net: **(a) scaled = the shipped floor; (b) ref-lock = the portable accelerator, gated on a sound stale-lock reclaim; (c) = optional host sugar only.**

## Q2

**Runner-merges-propose: should the runner gain an explicit 'runner performs the propose merge' capability, or is the floor honestly 'push-time gated only, document the limitation'?**

> Open Question 2. Propose's `freshWorktreeGate` covers the PR-PUSH tip, not the PR-MERGE-time tip — `main` may move between push and a human/auto-merge clicking merge. The only way to close that gap WITHOUT a capable host is for the RUNNER to perform the merge (its gate then covers the merge-time tip). If yes, where does it live (new `do`/`advance` mode? a `land` / `merge-pr` verb?) and how does it interact with propose's defining 'human approval REQUIRED before land' nature (does the runner merge only AFTER it observes approval)?

_Suggested default: Document the floor honestly ('push-time gated only on a bare host; mitigation = re-run verify after rebase before merging') AND add an OPT-IN `runner-merges-after-approval` mode (the runner watches for approval, then re-rebases + re-gates + merges) so the propose contract — human approves intent, machine asserts mergeability — is preserved. Default OFF; opt-in for repos that want the closure without a capable host._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

**The runner GAINS the merge capability — but it is NOT a new bespoke verb. It rides the ALREADY-RESOLVED surface->answer->apply rungs (OQ 2 in the brief body, resolved by the `advance-surface-apply-rungs…` finding).** So both halves of the suggested default are right, with this correction on the "where does it live" sub-question: it lives in advance's existing rungs, not a new `do`/`advance` mode and not a `land`/`merge-pr` verb.

Concretely, reconciling this answer with the brief's already-fixed Implementation Decisions:

- The FLOOR stays honestly documented: on a bare host where a human merges OUTSIDE the runner, the runner gated the push-time tip only; mitigation = `pull --rebase` + re-run `verify` before merging (see Q4). Keep that documented limitation.
- The CLOSURE is the runner-as-merger via advance: a STATE-sourced surfacer enumerates `work/*` branches unreachable from `main` (+ `gh pr list` where a host exists) and emits a MERGE-QUESTION (`merge|hold|drop`); the human ANSWER is the approval; apply dispatches an answered `merge` through the EXISTING land primitive (rebase -> re-verify on the rebased tip -> advance), refusing on a red re-verify. That is the runner performing the merge with ITS `freshWorktreeGate` covering the MERGE-time tip — closing the gap without a capable host.
- **How it preserves propose's "human approval REQUIRED before land" nature:** the runner merges only AFTER it observes the human answer (= the approval). propose SURFACES the merge-question and waits; merge-mode does NOT surface (auto-lands); both share the identical apply-time land. So "is a human approval required before the land" is exactly the propose-vs-merge distinction (story #2), expressed as "does this mode surface the merge-question or auto-answer it." The runner never lands a propose branch the human did not answer.
- This means the answer to the literal question "explicit capability vs push-time-gated-only floor?" is **BOTH, layered**: push-time-gated floor is the honest documented bare-host limitation; the opt-in runner-as-merger (through advance's rungs, gated by the merge-question axis of OQ 7, default not-`off`) is the portable closure. Do NOT build a standalone `land`/`merge-pr` verb — that would duplicate the disposition-dispatch the brief already commits to reusing.

## Q3

**Is GitHub Merge Queue (tier 2, `merge_group` trigger) IN scope for this brief, or a follow-on once tier 1 ships?**

> Open Question 3. Tier 1 (branch protection: required `verify` check + `strict: true` require-up-to-date) closes the drift window by forcing rebase + re-verify before the merge button works. Tier 2 (merge queue) ADDS speculative-rebase composition checking (catches two individually-green PRs that break together) AND removes the rebase-churn tier 1 creates, but is a materially larger CI-template change. OQ 4's resolution already notes the same ruleset call can carry the `merge_queue` rule, so the provisioning seam exists either way.

_Suggested default: Tier 1 in scope NOW (it closes the stated drift window); tier 2 captured as a follow-on brief (it is an optimisation + composition-catcher on top of an already-safe tier 1, and is a bigger CI-template change). Carry the merge_queue ruleset shape as a known forward seam so the follow-on is mechanical._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

**Confirmed: Tier 1 IN scope NOW; Tier 2 (GitHub Merge Queue, `merge_group` trigger) is a FOLLOW-ON brief. Carry the `merge_queue` ruleset shape as a known forward seam so the follow-on is mechanical.**

The split is clean on both value and cost:

- **Tier 1 closes the STATED drift window.** `required_status_checks: { strict: true, checks: [{ context: "verify" }] }` makes "require branches up to date before merging" + a required `verify` check enforce a rebase + re-verify against current `main` before the merge button works. That is the precise PR-merge-time gap problem #3 names. It MUST be in scope or the brief does not deliver its headline propose-mode fix on GitHub.
- **Tier 2 is an OPTIMISATION + composition-catcher on top of an already-safe Tier 1, and a materially bigger CI-template change** (a new `merge_group` trigger on the verify workflow, speculative-rebase semantics, churn-removal). It is not required for safety — Tier 1 already prevents a stale merge; Tier 2 additionally catches two-individually-green-PRs-break-together AND removes Tier 1's rebase churn. Both are real wins but neither is the stated gap. Bundling it bloats this brief's CI-template surface and its test matrix.
- **The provisioning seam already exists either way** (OQ 4 resolved: the same `install-ci` ruleset call that sets Tier 1 can carry the `merge_queue` rule). So scoping Tier 2 out costs nothing structurally — leave the ruleset shape extensible (a `merge_queue` rule slot the follow-on fills) and the follow-on is a mechanical addition, not a re-architecture.

Action: ship Tier 1 in this brief; open a follow-on brief for Tier 2 referencing the same ruleset provisioning seam; note in the ADR that the `merge_queue` rule is a deliberately-deferred forward seam, not an oversight.

## Q4

**Should the docs additionally WARN that a human's local `origin/main` reconcile must be a rebase + a manual `verify` (not a plain `git pull` merge)?**

> Open Question 5. `CLAIM-PROTOCOL.md` already tells the human-as-participant to reconcile via `pull --rebase` then push. A plain `git pull` (merge) does NOT re-run verify on the reconciled tree — observed LIVE during this brief's own session (`git push` rejected non-fast-forward → `git pull` merged → no verify ran on the merged tree; harmless that time only because the ledger files were disjoint). The tension: the human-as-participant path is EXPLICITLY allowed to be lower-assurance than the runner path, so a warning may be out of scope; on the other hand the failure mode is exactly the 'git said clean, verify did not run' shape this brief exists to make impossible.

_Suggested default: IN scope as a one-line warning + the exact two-command remediation (`git pull --rebase` then re-run `verify` before pushing) in `CLAIM-PROTOCOL.md` — cheap, directly motivated by a live in-session observation, and consistent with naming the invariant rather than relying on the human to infer it. Keep it a WARNING, not a gate (the human path stays lower-assurance by design)._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

**Confirmed: IN scope as a one-line WARNING (not a gate) in `CLAIM-PROTOCOL.md`, with the exact two-command remediation.** The human-as-participant path STAYS lower-assurance by design — this names the invariant, it does not enforce it.

Why in-scope despite the human path being explicitly allowed to be lighter:

- The failure mode is EXACTLY the shape this whole brief exists to make impossible: "git said clean, verify did not run." It was observed LIVE in this brief's own session (`git push` rejected non-fast-forward -> `git pull` MERGED -> no verify ran on the merged tree; harmless only because the ledger files were disjoint that time). A brief whose thesis is "a clean git merge validates the authored context, never the lived context" cannot leave the human reconcile silently reproducing the exact anti-pattern.
- "Lower-assurance" justifies NOT GATING the human path (no machine forces the re-verify); it does not justify failing to TELL the human the invariant. Naming it is cheap and consistent with the brief's north star ("name the primitive once").
- `CLAIM-PROTOCOL.md` already tells the human to reconcile via `pull --rebase` then push; this just adds WHY (a plain `git pull` merge does not re-run verify on the reconciled tree) and the remediation, so the existing instruction stops reading as arbitrary style.

Exact wording to add (a WARNING, not a gate), dual-written into `skills/setup/protocol/CLAIM-PROTOCOL.md` SOURCE + the `work/protocol/` mirror, `diff -r` clean, `VERSION` bumped:

> WARNING: reconcile with `origin/main` by REBASE, never a plain `git pull` merge — a merge does NOT re-run `verify` on the reconciled tree, so a clean merge can hide a semantically-broken result. If your push is rejected non-fast-forward: `git pull --rebase`, then re-run `verify` on the rebased tree BEFORE pushing. (The runner path enforces this automatically; on the human path it is on you.)

Keep it a WARNING explicitly so the human path remains the deliberately-lighter path — the runner path stays the assured one.
