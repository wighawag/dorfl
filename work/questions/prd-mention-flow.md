<!-- dorfl-sidecar: item=prd:mention-flow type=prd slug=mention-flow allAnswered=false -->

## Q1

**Bare-mention default intent. When the body is just `@dorfl` with no instruction, what is the default behaviour?**

> From `work/prds/proposed/mention-flow.md` → ## Open questions #1, and User Story #3 ("a bare mention should do a sensible default — summarise/advise on the current issue or PR"). Comparable tools (e.g. Claude's GitHub action) default to an interactive advise/summarise, not a prompt-back. This is a genuine fork: the answer shapes the intent router's default branch and therefore the Flow-A slice. Tasking on a guess would cut the wrong slice.

_Suggested default: Advise/summarise the issue or thread (matching the interactive default of comparable tools), NOT "ask the user what they want"._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Flow B confirmation model. When a TRUSTED mentioner says `@dorfl file a task` / `@dorfl fix this`, does the dispatch fire IMMEDIATELY, or does `@dorfl` always PROPOSE-and-wait-for-a-thumbs-up first?**

> From ## Open questions #2 and User Story #9. Composes with `runner-in-ci`'s merge-vs-propose + author-trust resolver: this PRD is `taskedAfter: [runner-in-ci, issue-intake]` and adds a new "command" value to that PRD's request-channel axis. The exact line determines the Flow-B slice's dispatch semantics and how it consumes runner-in-ci's resolver.

_Suggested default: Dispatch may fire immediately for a trusted mentioner when the resolved integration mode is itself non-merging (would open a PR / write to a staging pool — the human checkpoint is still ahead); anything that would land on `main` always asks first._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Mention authorisation floor. Who may summon `@dorfl` AT ALL (as distinct from who may make it MUTATE)? In particular, should the advisory flow (Flow A) also be gateable to write-collaborators-only for a private/locked-down repo?**

> From ## Open questions #3 and User Story #14. Mirrors `allowed_bots` / `allowed_non_write_users` in `anthropics/claude-code-action` (cited under Further Notes → Comparable reference). The advisory flow only posts a comment so the default floor can be permissive, but a private repo may want it tighter — confirming this shapes the configuration surface and the Flow-A slice's permission checks.

_Suggested default: Flow A is open to anyone who can comment (it only posts a comment); a configurable allow-list governs whether bot accounts may summon it; advisory is ALSO gateable to write-collaborators-only via the same config for locked-down repos._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Trigger phrase configurability + collision. Confirm the config key name for the trigger phrase, and that a repo may set a different phrase (e.g. to avoid colliding with the unrelated `@dorfl` GitHub account the maintainer does not own).**

> From ## Open questions #4 and User Story #7; the account-ownership constraint is recorded in Further Notes (maintainer owns `dorfl-agent`, not `@dorfl`). Implementation Decisions state "The trigger phrase is a configurable string defaulting to the brand base, decoupled from the posting account." The remaining decision is the concrete CONFIG KEY name and confirmation that per-repo override is supported — both affect the workflow template generator (`intake-trigger-template`-style) and `config.identity` shape.

_Suggested default: Phrase defaults to `${brand.base}` (i.e. `@dorfl`), is per-repo configurable under a config key like `mention.triggerPhrase` (decoupled from `config.identity` / the posting account), and `install-ci` writes it into the generated mention workflow's `contains(...)` guard._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
