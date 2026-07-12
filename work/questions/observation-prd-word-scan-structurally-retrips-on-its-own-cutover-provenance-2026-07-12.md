<!-- dorfl-sidecar: item=observation:prd-word-scan-structurally-retrips-on-its-own-cutover-provenance-2026-07-12 type=observation slug=prd-word-scan-structurally-retrips-on-its-own-cutover-provenance-2026-07-12 allAnswered=false -->

Item: [`observation:prd-word-scan-structurally-retrips-on-its-own-cutover-provenance-2026-07-12`](../notes/observations/prd-word-scan-structurally-retrips-on-its-own-cutover-provenance-2026-07-12.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Which durable fix should be pursued to stop the prd-word leak scan from recurrently re-tripping on the loop's own cutover-subject provenance: (a) exempt cutover-subject work/** bodies by a stable marker (frontmatter opt-in like cutoverSubject: true, or a directory convention) so exemption is by-construction; (b) narrow the WORD gate's work/** scope further, e.g. drop active work/tasks/* and work/notes/* from scope (they are provenance/working-material, not the current-guidance surface); (c) rely solely on the already-ready task provenance-file-basenames-widened-criterion-and-expiry-guard (which only makes the rot direction safe and does not stop reactive-append churn); or (d) some combination?**

> Observation body 'Candidate durable fixes' section lists these three options explicitly and defers the weigh-up to a human. The reactive hand-maintained PROVENANCE_FILE_BASENAMES list has already gone stale (two discharged entries) and has already reddened main at least once (see the 7be9bd2d note in flagged task bodies).

_Suggested default: (a) stable frontmatter marker (cutoverSubject: true) — kills the reactive-append churn AND self-heals on discharge; can compose with the ready expiry-guard task._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Is the already-ready task provenance-file-basenames-widened-criterion-and-expiry-guard sufficient on its own, or must a second task be minted for the chosen structural fix above?**

> work/tasks/ready/provenance-file-basenames-widened-criterion-and-expiry-guard.md widens the criterion and adds an expiry guard, but per the observation it 'does not stop the reactive-append churn' — so it addresses rot direction, not root cause. Also work/tasks/ready/exempt-work-questions-sidecars-from-prd-word-leak-scan.md is a separate narrower carve-out for sidecars only.

_Suggested default: Not sufficient alone: land the ready task AND mint a follow-up task for the chosen structural fix (a or b)._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
