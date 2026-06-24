<!-- dorfl-sidecar: item=observation:adr-methodology-still-cites-slicing-protocol-doc-filename-2026-06-23 type=observation slug=adr-methodology-still-cites-slicing-protocol-doc-filename-2026-06-23 allAnswered=false -->

## Q1

**Drop this observation as superseded: the claimed dangling `SLICING-PROTOCOL.md` filename reference at `docs/adr/methodology-and-skills.md:81` no longer exists — line 81 already cites `TASKING-PROTOCOL.md`, and the only remaining `slicing`/`slice` mentions (lines 38/44/49) are intentional historical prose protected by the §0 forward note at line 14 ("read every `slice` below as **task** … the verb `slicing` as **tasking** … the original text is left intact to preserve the decision history"). Agree to drop, or is there still something to sweep here?**

> Observation claims: "docs/adr/methodology-and-skills.md:81 still references the old filename SLICING-PROTOCOL.md". Verification on disk (2026-06-23): `grep -n 'SLICING-PROTOCOL' docs/adr/methodology-and-skills.md` returns NO matches. Line 81 (the `runner-invoked-disciplines-into-protocol` refinement bullet) reads "…and tasking (`TASKING-PROTOCOL.md`)" — the filename is already the new one. The `slicing`/`slice` verbiage that does remain (lines 38, 44, 49) sits BELOW the §0 forward note on line 14 that explicitly grandfathers it as historical decision-record text — exactly the convention this observation worries was violated. The follow-on prose-sweep tasks in backlog (`rename-protocol-prose-workcontract-and-surface-slicing-to-tasking.md`, `rename-src-comment-prose-slicing-to-tasking.md`) deliberately scope to protocol/templates/skills/src comments, NOT `docs/adr/` — consistent with the forward-note convention. So both the filename claim AND the implicit "ADR needs its own sweep task" suggestion appear unfounded.

_Suggested default: dropped — superseded by current reality (no dangling filename on disk; historical `slicing` prose is intentional per the line-14 forward note)._

<!-- q1 fields: id=q1 disposition=dropped -->

**Your answer** (write below this line):

dropped (reason: superseded by current docs state). Verified: `grep -n 'SLICING-PROTOCOL' docs/adr/methodology-and-skills.md` returns no matches; line 81 already cites `TASKING-PROTOCOL.md`; the residual `slicing`/`slice` prose (lines 38/44/49) is intentional historical decision-record text grandfathered by the §0 forward note at line 14. No dangling filename and no ADR sweep needed.
