<!-- agent-runner-sidecar: item=brief:land-time-reverify-and-parallel-merge-ceiling type=brief slug=land-time-reverify-and-parallel-merge-ceiling allAnswered=false -->

## Q1

**Cross-job merge serialiser for parallel merge in CI — git-alone floor + optional accelerator?**

> Open Question 1. The in-memory `integrateLock` does not span CI jobs; only the CAS loop (`DEFAULT_MERGE_RETRIES = 5`, sized for in-process siblings) serialises across jobs. A wide matrix burst risks bouncing losers to needs-attention. Options: (a) just SCALE `mergeRetries` to expected matrix width (simple, git-alone, but burst past cap still bounces); (b) a cross-job concurrency group / ref-based land-lock so losers QUEUE rather than retry-then-bounce; (c) GitHub Actions `concurrency:` on the merge job (host-specific — violates the git-alone-floor framing for the SERIALISER itself). The brief itself flags 'likely (a) as the git-alone floor + (b) or (c) as an optional accelerator — confirm.'

_Suggested default: (a) scaled `mergeRetries` as the git-alone floor + (b) a ref-based cross-job land-lock as the portable accelerator (preferred over (c) so the accelerator is not GitHub-only); (c) remains available where the host offers it._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Runner-merges-propose: should the runner gain an explicit 'runner performs the propose merge' capability, or is the floor honestly 'push-time gated only, document the limitation'?**

> Open Question 2. Propose's `freshWorktreeGate` covers the PR-PUSH tip, not the PR-MERGE-time tip — `main` may move between push and a human/auto-merge clicking merge. The only way to close that gap WITHOUT a capable host is for the RUNNER to perform the merge (its gate then covers the merge-time tip). If yes, where does it live (new `do`/`advance` mode? a `land` / `merge-pr` verb?) and how does it interact with propose's defining 'human approval REQUIRED before land' nature (does the runner merge only AFTER it observes approval)?

_Suggested default: Document the floor honestly ('push-time gated only on a bare host; mitigation = re-run verify after rebase before merging') AND add an OPT-IN `runner-merges-after-approval` mode (the runner watches for approval, then re-rebases + re-gates + merges) so the propose contract — human approves intent, machine asserts mergeability — is preserved. Default OFF; opt-in for repos that want the closure without a capable host._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Is GitHub Merge Queue (tier 2, `merge_group` trigger) IN scope for this brief, or a follow-on once tier 1 ships?**

> Open Question 3. Tier 1 (branch protection: required `verify` check + `strict: true` require-up-to-date) closes the drift window by forcing rebase + re-verify before the merge button works. Tier 2 (merge queue) ADDS speculative-rebase composition checking (catches two individually-green PRs that break together) AND removes the rebase-churn tier 1 creates, but is a materially larger CI-template change. OQ 4's resolution already notes the same ruleset call can carry the `merge_queue` rule, so the provisioning seam exists either way.

_Suggested default: Tier 1 in scope NOW (it closes the stated drift window); tier 2 captured as a follow-on brief (it is an optimisation + composition-catcher on top of an already-safe tier 1, and is a bigger CI-template change). Carry the merge_queue ruleset shape as a known forward seam so the follow-on is mechanical._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Should the docs additionally WARN that a human's local `origin/main` reconcile must be a rebase + a manual `verify` (not a plain `git pull` merge)?**

> Open Question 5. `CLAIM-PROTOCOL.md` already tells the human-as-participant to reconcile via `pull --rebase` then push. A plain `git pull` (merge) does NOT re-run verify on the reconciled tree — observed LIVE during this brief's own session (`git push` rejected non-fast-forward → `git pull` merged → no verify ran on the merged tree; harmless that time only because the ledger files were disjoint). The tension: the human-as-participant path is EXPLICITLY allowed to be lower-assurance than the runner path, so a warning may be out of scope; on the other hand the failure mode is exactly the 'git said clean, verify did not run' shape this brief exists to make impossible.

_Suggested default: IN scope as a one-line warning + the exact two-command remediation (`git pull --rebase` then re-run `verify` before pushing) in `CLAIM-PROTOCOL.md` — cheap, directly motivated by a live in-session observation, and consistent with naming the invariant rather than relying on the human to infer it. Keep it a WARNING, not a gate (the human path stays lower-assurance by design)._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
