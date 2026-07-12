<!-- dorfl-sidecar: item=observation:prd-word-leak-scan-fails-on-bot-generated-triage-sidecars-2026-07-12 type=observation slug=prd-word-leak-scan-fails-on-bot-generated-triage-sidecars-2026-07-12 allAnswered=false -->

Item: [`observation:prd-word-leak-scan-fails-on-bot-generated-triage-sidecars-2026-07-12`](../notes/observations/prd-word-leak-scan-fails-on-bot-generated-triage-sidecars-2026-07-12.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Which scan-scope fix should be adopted: exempt work/questions/ sidecars from the prd-word leak scan (option 1), also exempt work/notes/observations/ bodies (option 2), or leave scope unchanged and only drain sources (options 3/4)?**

> The observation body enumerates four options and suggests option 1 as the principled scan-scope fix (policing authored prose, not derived sidecar text that quotes a source). The choice is a judgement call not made inline. See 'Options to weigh' in work/notes/observations/prd-word-leak-scan-fails-on-bot-generated-triage-sidecars-2026-07-12.md.

_Suggested default: Option 1 (exempt work/questions/ sidecars) — narrowest scan-scope fix matching the scan's authored-prose intent._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Independent of the scan-scope choice, should the 32 already-landed prd-quoting sidecars on main be discharged now (answer/apply or direct-delete) to un-red main immediately?**

> main is currently red on its own verify gate because bot-surfaced sidecars quote prd-word observation bodies verbatim. Even after a scan-scope fix, these sidecars exist; a scope fix alone unblocks future writes but the 32 files still need disposition per the underlying observations.

_Suggested default: Yes — un-red main by discharging the sidecars (via triage of the underlying cutover observations), in parallel with adopting a scan-scope fix so the loop stops re-tripping._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
