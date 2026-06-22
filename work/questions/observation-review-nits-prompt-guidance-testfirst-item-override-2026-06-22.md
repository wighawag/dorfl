<!-- agent-runner-sidecar: item=observation:review-nits-prompt-guidance-testfirst-item-override-2026-06-22 type=observation slug=review-nits-prompt-guidance-testfirst-item-override-2026-06-22 allAnswered=false -->

## Q1

**Nit 1 — SOURCE-vs-MIRROR drift in WORK-CONTRACT.md: how should this observation's first finding be triaged (promote a tiny chore-slice to delete the extra blank line, keep open, or delete as already-resolved)?**

> The observation reports a trailing blank line at line 218 of `work/protocol/WORK-CONTRACT.md` not present in `skills/setup/protocol/WORK-CONTRACT.md`, violating the AGENTS.md invariant `diff -r skills/setup/protocol work/protocol` is clean. RE-CHECKED at surface time: `diff skills/setup/protocol/WORK-CONTRACT.md work/protocol/WORK-CONTRACT.md` now produces NO output — the drift appears to have already been corrected since the observation was written. If still desired, a 1-line chore-slice would suffice; otherwise this finding is moot.

_Suggested default: delete — re-check shows the diff is now clean; the finding is stale and there is nothing to fix._

<!-- q1 fields: id=q1 disposition=delete -->

**Your answer** (write below this line):

## Q2

**Nit 2 — five non-obvious design decisions from the `prompt-guidance-testfirst-item-override` slice were not recorded in a `## Decisions` block. How should they be triaged: (a) DOTTED scalar `promptGuidance.testFirst` via widening the top-level key regex to `[A-Za-z0-9_.]+` (frontmatter.ts:306) vs. nested YAML mapping; (b) brief lookup order `briefs/ready/<slug>.md` then `briefs/tasked/<slug>.md` (prompt.ts:`findBriefPath`); (c) a task with no `brief:` may still carry the override (chore symmetry with `humanOnly`); (d) a missing brief file is SILENT fall-through to repo policy (no error/warning); (e) `agent-runner prompt` now performs additional file I/O per invocation (re-reads task and possibly a brief file). Promote one ADR covering all five, promote individual ADRs/tasks, keep open for later, or accept as ratified (record in a follow-up Decisions note) and delete?**

> The observation explicitly flags these for human ratification only and states 'All choices are reasonable; none is load-bearing-and-hard-to-reverse.' The most ADR-worthy candidate is (a) — the dotted-scalar frontmatter convention establishes a precedent for any future per-item override key and so deserves a durable rationale beyond a code comment. (b)-(e) are local conventions that, if ratified, can sit in a short Decisions note without their own ADRs. Source: `work/notes/observations/review-nits-prompt-guidance-testfirst-item-override-2026-06-22.md` and frontmatter.ts:306, packages/agent-runner/src/prompt.ts (`findBriefPath`, `resolvePromptGuidanceForItem`, `renderPrompt`).

_Suggested default: promote-adr — author a single ADR for (a) the dotted-scalar frontmatter convention (since it establishes precedent for future overrides), and accept (b)-(e) as ratified by recording them in the ADR's 'Related minor decisions' section; then delete this observation._

<!-- q2 fields: id=q2 disposition=promote-adr -->

**Your answer** (write below this line):
