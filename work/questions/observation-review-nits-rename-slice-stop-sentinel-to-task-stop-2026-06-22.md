<!-- agent-runner-sidecar: item=observation:review-nits-rename-slice-stop-sentinel-to-task-stop-2026-06-22 type=observation slug=review-nits-rename-slice-stop-sentinel-to-task-stop-2026-06-22 allAnswered=false -->

## Q1

**Ratify the unrecorded in-scope decision: editing CLAIM-PROTOCOL.md (both SOURCE skills/setup/protocol/ and work/protocol/ MIRROR) is the correct way to satisfy 'update the prompt text that instructs the agent to emit the block' — because prompt.ts reads the canonical wrapper template out of CLAIM-PROTOCOL.md at runtime. Accept as-is, or require a different surface to change?**

> Observation finding #1. git show c11f78b touches skills/setup/protocol/CLAIM-PROTOCOL.md + work/protocol/CLAIM-PROTOCOL.md; prompt.ts:138 'Pull the canonical wrapper TEMPLATE out of CLAIM-PROTOCOL.md'; the two copies are byte-identical, honoring the SOURCE/MIRROR rule. No '## Decisions' block in the PR/commit body, so the choice was never surfaced. No reversal proposed — this is a ratification ask.

_Suggested default: keep — accept the decision as correct (CLAIM-PROTOCOL.md IS the prompt-emission surface via prompt.ts:138-188); no follow-up task needed since the choice is sound and the SOURCE/MIRROR pair is in sync. The unrecorded-decision process gap itself is a separate concern, not this observation's job._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

## Q2

**Confirm the stale 'slice' prose in agent-stop.ts (line 5 'slice agent-stop-signal', line 13 'the slice DRIFTED', line 20 'a cross-slice interaction', line 26 'skills/to-slices/CLAIM-PROTOCOL.md') is intentionally deferred to the later 'source modules + symbols / comment prose sweep' task — not a miss in this slice — and that this observation can therefore be dropped (the sweep task already covers it)?**

> Observation finding #2. Brief Decision 4 scopes the just-landed task to the sentinel token + STOP_SENTINEL_* constants + emitting prompt + asserting tests; the Solution staging list assigns the broader comment-prose sweep to a separate later task. The stale 'skills/to-slices/' path is pre-existing (not introduced by this diff) and does not affect runtime resolution (prompt.ts resolves CLAIM-PROTOCOL.md by basename). agent-stop.ts:5,13,20,26.

_Suggested default: dropped — superseded by the already-scoped later 'source modules + symbols / comment prose sweep' task; reason 'superseded by the planned comment-prose sweep task' belongs in the item body. No new task to spawn from this observation._

<!-- q2 fields: id=q2 disposition=dropped -->

**Your answer** (write below this line):
