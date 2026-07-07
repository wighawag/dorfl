<!-- dorfl-sidecar: item=prd:mention-flow type=prd slug=mention-flow allAnswered=false -->

## Q1

**Bare-mention default intent. When the body is just `@dorfl` with no instruction, what is the default? Proposed: advise/summarise the issue or thread (matching the interactive default of comparable tools), NOT "ask the user what they want". Confirm or override.**

> PRD `## Open questions` #1 (needsAnswers: true). Drives the intent router's `advise` default (Implementation Decisions: "The intent ROUTER is the genuinely new logic ... `advise` default, or `dispatch <verb>`") and US #3. Tasking the router on a guess would cut the wrong default behaviour.

_Suggested default: Advise/summarise the current issue or PR (the lightest-weight interaction), matching comparable tools' interactive default._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Advise/summarise the current issue or PR (the lightest-weight, read-only interaction), NOT "ask the user what they want." Writes nothing. This is Flow A, the keystone.

## Q2

**Flow B confirmation model. When a TRUSTED mentioner says `@dorfl file a task` / `@dorfl fix this`, does the dispatch fire IMMEDIATELY, or does `@dorfl` always PROPOSE-and-wait-for-a-thumbs-up first? Confirm the exact line.**

> PRD `## Open questions` #2 (needsAnswers: true), and US #9. Proposed line: dispatch may fire immediately for a trusted mentioner when the resolved integration mode is itself non-merging (would open a PR / write to a staging pool anyway, so the human checkpoint is still ahead); anything that would land on `main` always asks first. This is the merge-vs-propose boundary for the conversational channel.

_Suggested default: Dispatch may fire immediately for a trusted mentioner IFF the resolved mode is non-merging (PR/staging-pool); anything landing on `main` always proposes-and-waits first._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

CONSTRAIN Flow B to the work protocol: `@dorfl` must NOT do things outside the work protocol, and in particular "@dorfl fix this" does NOT mean the agent edits code directly. "fix this" / "file a task" means: CREATE a work artifact (a task, or a prd if larger), routed through the normal intake-shaped path. Placement: a task created from a TRUSTED mention goes straight into `tasks/ready/` so the loop picks it up (no separate promote step needed for a trusted origin); an untrusted mention can at most create a STAGED/proposed artifact (staging pool / proposed-prd), never a ready task and never anything that auto-lands on main (see Q3). If the request is unclear, the mention flow ASKS a clarifying question in the thread, exactly like intake's `ask` outcome, rather than guessing. So the confirmation model is: the mutation is always "create a work-protocol artifact" (never a direct code edit); trusted => the artifact may be created immediately in ready; untrusted => staged only; ambiguous => ask. Nothing dispatched via `@dorfl` may bypass the merge-vs-propose + author-trust policy or land on main automatically.

## Q3

**Mention authorisation floor. Who may summon `@dorfl` AT ALL (distinct from who may make it MUTATE)? In particular, confirm whether the advisory flow (Flow A) should also be gateable to write-collaborators-only for a private/locked-down repo.**

> PRD `## Open questions` #3 (needsAnswers: true), and US #14. Proposed: Flow A open to anyone who can comment (it only posts a comment); a configurable allow-list governs bot accounts; mirrors `allowed_bots` / `allowed_non_write_users` of claude-code-action. The open fork is the private/locked-down-repo case.

_Suggested default: Flow A open to any commenter by default, with a configurable allow-list for bots and an opt-in write-collaborators-only gate for locked-down repos._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Configurable authorisation floor. Flow A (advisory, comment-only) open to any commenter by DEFAULT, with a configurable allow-list for bot accounts and an opt-in write-collaborators-only gate for private/locked-down repos. CRITICAL trust requirement for any created artifact (Flow B): the created task/prd MUST RECORD ITS ORIGIN (the mentioner's handle + trust level + source thread) in its frontmatter/body, so trust is carried forward and an UNTRUSTED origin can never result in code landing on main automatically. Concretely: an untrusted-origin artifact is staged/proposed only and is fenced from the autonomous build->merge path (it requires an explicit human promotion before it can be claimed/built/merged); a trusted origin may go to ready. The origin record is the load-bearing mechanism, do not create an untrusted task without stamping its provenance.

## Q4

**Trigger phrase configurability + collision. Confirm the config KEY NAME for the trigger phrase, and that a repo may set a phrase different from the `@dorfl` brand base (e.g. to avoid colliding with the unrelated, maintainer-not-owned `@dorfl` GitHub account).**

> PRD `## Open questions` #4 (needsAnswers: true), US #7, and the Further Notes account-ownership constraint (maintainer owns `dorfl-agent`, not `dorfl`). Phrase defaults to the brand base and is decoupled from the posting account; the open item is the exact config key name and confirming per-repo override.

_Suggested default: Phrase defaults to `${brand.base}` (`@dorfl`) and is per-repo configurable; pick a key name consistent with existing config (e.g. mirroring claude-code-action's `trigger_phrase`)._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Confirmed. The trigger phrase defaults to the brand base (`@dorfl`) and is per-repo configurable, decoupled from the posting account. Config key name: `trigger_phrase` (mirroring the claude-code-action prior art).

## Q5

**Flow B's dependency on the still-OPEN runner-in-ci author-trust resolver: how should the build order be pinned so a Flow B slice cannot be claimed before the resolver it consumes exists? The PRD names the dependency in prose ("must `taskedAfter`/`blockedBy` the slice that lands it") but encodes only a PRD-level `taskedAfter: [runner-in-ci, ...]`, which does not serialise per-slice build order. Confirm the intended `blockedBy` wiring at slicing time.**

> Composition (review lens 3 + lens 5) against `work/prds/tasked/runner-in-ci.md`. That PRD's author-trust resolver is its ONE open `needsAnswers` (`runner-in-ci.md:150`: "the EXACT resolver ... and where it lives in the CI wiring is OPEN"), and the mention PRD ADDS a new value (`command` via mention) to its request-channel axis. mention-flow Out of Scope (line 96) defers the resolver to runner-in-ci and the slicing note (line 108) says Flow B is `taskedAfter` the author-trust slice, but no concrete slug is pinned. Risk: a Flow B slice cut before the resolver lands builds trust plumbing on an undefined foundation.

_Suggested default: At `to-slices` time, give every Flow B (dispatch) slice a concrete `blockedBy` referencing the runner-in-ci author-trust resolver slice; keep Flow A (advisory) free of that dependency so the keystone slice stays buildable now._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):

At `to-task` time, give every Flow B (dispatch/create-artifact) task a concrete `blockedBy` referencing the runner-in-ci author-trust resolver task; keep Flow A (advisory) free of that dependency so the keystone slice stays buildable now. The origin-recording + untrusted-fencing requirement from Q3 also depends on that resolver, so it belongs in the Flow B slice(s), not Flow A.

## Q6

**Non-blocking: the prior-art file paths in Further Notes are written as bare `src/...` (e.g. `src/intake.ts`, `src/issue-provider.ts`) but the code actually lives under `packages/dorfl/src/...`. Should the slicing/prompt references be normalised to the real package-relative paths so a fresh build agent does not chase ghost paths?**

> Claim-vs-reality (review lens 1). The referenced symbols and behaviours all VERIFY (e.g. `${brand.base}:intake` namespace at `intake-marker.ts:55`; `TERMINAL_KINDS = {bounced, created}` terminal-skip at `intake-triage.ts:28`/branch 2; `IssueProvider.postIssueComment` at `issue-provider.ts:258/266`) but every path is prefixed `packages/dorfl/src/` in this monorepo, not bare `src/`. Cosmetic for a human, but a low-friction fix for a fresh-context build agent.

_Suggested default: Normalise to `packages/dorfl/src/...` when `to-slices` lifts these references into task prompts._

<!-- q6 fields: id=q6 -->

**Your answer** (write below this line):

Normalise the prior-art references to the real `packages/dorfl/src/...` paths when `to-task` lifts them into task prompts, so a fresh-context build agent does not chase ghost `src/...` paths.
