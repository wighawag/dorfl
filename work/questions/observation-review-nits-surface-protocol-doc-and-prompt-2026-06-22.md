<!-- dorfl-sidecar: item=observation:review-nits-surface-protocol-doc-and-prompt-2026-06-22 type=observation slug=review-nits-surface-protocol-doc-and-prompt-2026-06-22 allAnswered=false -->

## Q1

**What should become of this signal? It is a Gate-2 review record (reviewOf: surface-protocol-doc-and-prompt) that APPROVED the PR but parked three non-blocking nits for triage. The PR has long since merged (#200) and the doc + prompt have since been swept to the task/brief/tasking vocabulary. Should this observation be ratified-and-deleted (the nits accepted as authorised), promoted to a task (if any nit warrants a code/doc change), or kept open?**

> work/notes/observations/review-nits-surface-protocol-doc-and-prompt-2026-06-22.md (status: open, needsAnswers: true). All three findings are self-described as non-blocking ratification asks ("Flagging for ratification, not removal"), not defects. A prior sidecar surfacing these 3 questions (commit 7d8e4ee) was deliberately removed (a3a9f14) to be rebuilt in the new binary format, so this is that rebuild. No new defect surfaced on re-investigation: the doc and the surface-gate.ts prompt still match the nits' descriptions.

_Suggested default: Ratify and delete: all three are non-blocking design choices that trace cleanly to the slice spec + the keystone (REVIEW-PROTOCOL) precedent, with no behavioural defect; if you concur, the direct-delete path removes the source + sidecar in one revertible commit._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Ratify (nit 1): the doc preamble/title (`# SURFACE-PROTOCOL`, the protocol-native intro, the WORK-CONTRACT/REVIEW-PROTOCOL framing blockquote) was REWRITTEN to fit the protocol-doc shape rather than lifted verbatim from skills/surface-questions/SKILL.md, even though the slice prompt said the body moves VERBATIM. The discipline body (two laws, humility rule, what-you-compose, the shape, no-runner path, boundaries) IS byte-for-byte; only the framing intro was re-authored, matching the call the keystone made for REVIEW-PROTOCOL.md. Is this re-authoring of the framing intro authorised?**

> Confirmed against work/protocol/SURFACE-PROTOCOL.md: intro lines ~1–10 are protocol-doc shaped (mirroring REVIEW-PROTOCOL.md's opener); sections from `## When to use vs. not` onward are the unchanged discipline body (modulo the D2-authorised JSON-shape example). Flagged only because the slice did not explicitly authorise the intro rewrite.

_Suggested default: Authorised: same intentional pattern applied to the keystone REVIEW-PROTOCOL.md; the verbatim requirement covers the discipline body, which was honoured._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Ratify (nit 2): the surfaced PR commit carried NO `## Decisions` block (only a one-line subject), so the keystone-adoption choices (protocol-doc preamble rewording, the in-doc JSON example, the prompt's residual empty-array-valid/absence-not line) were never recorded in-band. Is the missing Decisions block acceptable here, or should a Decisions-block discipline be enforced for such slices going forward?**

> Original finding noted `git log -1 --format=%B HEAD` showed only the subject line. The choices trace cleanly to the slice spec + keystone precedent, so nothing was lost in substance, only unrecorded. This is a process nit about commit-message discipline, not a defect in the merged artifact.

_Suggested default: Accept as-is for this merged item (choices are reconstructible from the slice + keystone); if commit Decisions-block discipline matters generally, raise it as its own observation/task rather than reopening this one._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Ratify (nit 3): `buildSurfacePrompt` still restates two pieces of doc content — the discipline's table-of-contents line ("Its two laws, its humility aid, the composed sources... ALL live in that doc — read them there") and the empty-array-valid / absence-invalid output-shape rule. The slice's no-re-inlining test only forbids the LAW STRINGS (which pass), so this is a tiny, deliberate duplication of an output-shape contract the parser enforces. Keep it, or trim the prompt to defer entirely to the doc?**

> Confirmed still present in packages/dorfl/src/surface-gate.ts: the table-of-contents line at ~lines 208–210 and the empty/absence rule at ~lines 224–226. It mirrors the review-prompt's style of restating output-format invariants and is judgement-cheap to keep; flagged for ratification, not removal.

_Suggested default: Keep: it is a practical output-shape contract the parser enforces, mirrors the review prompt, and re-inlines no law string (the test passes)._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
