<!-- dorfl-sidecar: item=observation:spec-lock-sidecar-namespace-was-missed-by-first-expand-task type=observation slug=spec-lock-sidecar-namespace-was-missed-by-first-expand-task allAnswered=false -->

Item: [`observation:spec-lock-sidecar-namespace-was-missed-by-first-expand-task`](../notes/observations/spec-lock-sidecar-namespace-was-missed-by-first-expand-task.md)

## Q1

**What becomes of this observation? The concrete conductor fix (adding expand-spec-lock-and-sidecar-namespace, re-pointing batch 2, extending the alias-removal list) is already applied and the follow-up task is in work/tasks/ready — so the operational residue is discharged. Only the META-LESSON remains: for coined-token renames, definitional MINT/MAP surfaces (unions, prefix maps, namespace resolvers) are systematically under-enumerated by the first expand task, and this is the SECOND such catch by a do-agent STOP. Should that lesson be (a) minted as a finding under work/findings/ (e.g. a 'rename-expand-checklist' note enumerating definitional-vs-consumer surface classes), (b) folded into WORK-CONTRACT.md / to-task guidance so future expand tasks enumerate mint/map sites first, (c) minted as an ADR on rename-expand discipline, or (d) dropped as already-internalised by the conductor?**

> work/notes/observations/spec-lock-sidecar-namespace-was-missed-by-first-expand-task.md — fix section says 'Added expand-spec-lock-and-sidecar-namespace ... no human re-decision needed'. Confirmed: work/tasks/ready/expand-spec-lock-and-sidecar-namespace.md exists alongside expand-spec-frontmatter-and-namespace-aliases.md. The observation itself flags the general lesson as its main content (§Why it matters).

_Suggested default: (a) mint a short finding at work/findings/rename-expand-definitional-surfaces.md capturing the mint/map-vs-consumer taxonomy and the two-catches provenance, then delete this observation — lightest-weight capture of the meta-lesson without over-committing to protocol change._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Option (a): mint a finding under work/notes/findings/ (a 'rename-expand checklist' enumerating the definitional-vs-consumer surface classes: unions, prefix maps, namespace resolvers). This is the SECOND such do-agent STOP catch, so the pattern is real and recurring, and a concrete enumerable checklist is more actionable than folding it into WORK-CONTRACT prose (b) or a discipline ADR (c). The conductor fix has already landed, so only this durable lesson remains.
