<!-- dorfl-sidecar: item=prd:mention-flow type=prd slug=mention-flow allAnswered=false -->

## Q1

**Bare-mention default intent. When the body is just `@dorfl` with no instruction, what is the default? Proposed: advise/summarise the issue or thread (matching the interactive default of comparable tools), NOT "ask the user what they want". Confirm or override.**

> PRD `## Open questions` #1 (needsAnswers: true). Drives the intent router's `advise` default (Implementation Decisions: "The intent ROUTER is the genuinely new logic ... `advise` default, or `dispatch <verb>`") and US #3. Tasking the router on a guess would cut the wrong default behaviour.

_Suggested default: Advise/summarise the current issue or PR (the lightest-weight interaction), matching comparable tools' interactive default._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Flow B confirmation model. When a TRUSTED mentioner says `@dorfl file a task` / `@dorfl fix this`, does the dispatch fire IMMEDIATELY, or does `@dorfl` always PROPOSE-and-wait-for-a-thumbs-up first? Confirm the exact line.**

> PRD `## Open questions` #2 (needsAnswers: true), and US #9. Proposed line: dispatch may fire immediately for a trusted mentioner when the resolved integration mode is itself non-merging (would open a PR / write to a staging pool anyway, so the human checkpoint is still ahead); anything that would land on `main` always asks first. This is the merge-vs-propose boundary for the conversational channel.

_Suggested default: Dispatch may fire immediately for a trusted mentioner IFF the resolved mode is non-merging (PR/staging-pool); anything landing on `main` always proposes-and-waits first._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Mention authorisation floor. Who may summon `@dorfl` AT ALL (distinct from who may make it MUTATE)? In particular, confirm whether the advisory flow (Flow A) should also be gateable to write-collaborators-only for a private/locked-down repo.**

> PRD `## Open questions` #3 (needsAnswers: true), and US #14. Proposed: Flow A open to anyone who can comment (it only posts a comment); a configurable allow-list governs bot accounts; mirrors `allowed_bots` / `allowed_non_write_users` of claude-code-action. The open fork is the private/locked-down-repo case.

_Suggested default: Flow A open to any commenter by default, with a configurable allow-list for bots and an opt-in write-collaborators-only gate for locked-down repos._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Trigger phrase configurability + collision. Confirm the config KEY NAME for the trigger phrase, and that a repo may set a phrase different from the `@dorfl` brand base (e.g. to avoid colliding with the unrelated, maintainer-not-owned `@dorfl` GitHub account).**

> PRD `## Open questions` #4 (needsAnswers: true), US #7, and the Further Notes account-ownership constraint (maintainer owns `dorfl-agent`, not `dorfl`). Phrase defaults to the brand base and is decoupled from the posting account; the open item is the exact config key name and confirming per-repo override.

_Suggested default: Phrase defaults to `${brand.base}` (`@dorfl`) and is per-repo configurable; pick a key name consistent with existing config (e.g. mirroring claude-code-action's `trigger_phrase`)._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**Flow B's dependency on the still-OPEN runner-in-ci author-trust resolver: how should the build order be pinned so a Flow B slice cannot be claimed before the resolver it consumes exists? The PRD names the dependency in prose ("must `taskedAfter`/`blockedBy` the slice that lands it") but encodes only a PRD-level `taskedAfter: [runner-in-ci, ...]`, which does not serialise per-slice build order. Confirm the intended `blockedBy` wiring at slicing time.**

> Composition (review lens 3 + lens 5) against `work/prds/tasked/runner-in-ci.md`. That PRD's author-trust resolver is its ONE open `needsAnswers` (`runner-in-ci.md:150`: "the EXACT resolver ... and where it lives in the CI wiring is OPEN"), and the mention PRD ADDS a new value (`command` via mention) to its request-channel axis. mention-flow Out of Scope (line 96) defers the resolver to runner-in-ci and the slicing note (line 108) says Flow B is `taskedAfter` the author-trust slice, but no concrete slug is pinned. Risk: a Flow B slice cut before the resolver lands builds trust plumbing on an undefined foundation.

_Suggested default: At `to-slices` time, give every Flow B (dispatch) slice a concrete `blockedBy` referencing the runner-in-ci author-trust resolver slice; keep Flow A (advisory) free of that dependency so the keystone slice stays buildable now._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):

## Q6

**Non-blocking: the prior-art file paths in Further Notes are written as bare `src/...` (e.g. `src/intake.ts`, `src/issue-provider.ts`) but the code actually lives under `packages/dorfl/src/...`. Should the slicing/prompt references be normalised to the real package-relative paths so a fresh build agent does not chase ghost paths?**

> Claim-vs-reality (review lens 1). The referenced symbols and behaviours all VERIFY (e.g. `${brand.base}:intake` namespace at `intake-marker.ts:55`; `TERMINAL_KINDS = {bounced, created}` terminal-skip at `intake-triage.ts:28`/branch 2; `IssueProvider.postIssueComment` at `issue-provider.ts:258/266`) but every path is prefixed `packages/dorfl/src/` in this monorepo, not bare `src/`. Cosmetic for a human, but a low-friction fix for a fresh-context build agent.

_Suggested default: Normalise to `packages/dorfl/src/...` when `to-slices` lifts these references into task prompts._

<!-- q6 fields: id=q6 -->

**Your answer** (write below this line):
