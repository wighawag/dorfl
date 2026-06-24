<!-- dorfl-sidecar: item=observation:review-nits-work-contract-sanction-deletion-on-apply-discharge-2026-06-24 type=observation slug=review-nits-work-contract-sanction-deletion-on-apply-discharge-2026-06-24 allAnswered=false -->

## Q1

**What becomes of this observation (three non-blocking Gate-2 review nits on the 'sanction deletion-on-apply discharge' WORK-CONTRACT edit at skills/setup/protocol/WORK-CONTRACT.md:70)?**

> The observation parks three nits flagged on the approved Gate-2 review of work-contract-sanction-deletion-on-apply-discharge. Checked against current source:
>
> 1. `duplicate`-as-disposition slip (still live). WORK-CONTRACT.md:70 reads '…(`promote-task`/`promote-prd`/`promote-adr`, or `dropped`/`duplicate`)' as if `duplicate` were a disposition, but SURFACE-PROTOCOL.md:47/58 enumerates exactly `promote-task | promote-prd | promote-adr | keep | delete | dropped | needs-attention` — `duplicate` is a REASON recorded in the body under the generic `dropped` terminal (WORK-CONTRACT.md:31, :67). The same slip exists in the originating prd's Resolved decision 4. Fix would be: replace `dropped`/`duplicate` with `dropped` (reason: duplicate / out-of-scope / …) in both places.
>
> 2. `promote-prd` forward-reference (APPEARS RESOLVED BY CURRENT REALITY). The nit was filed when `promote-prd` was not yet in SURFACE-PROTOCOL's disposition set. As of now SURFACE-PROTOCOL.md:47 and :58 BOTH list `promote-prd` verbatim — the sibling task `promote-prd-disposition-and-triage-local-cas-prd-writer` has landed and the forward reference is no longer dangling. This nit is likely a no-op / delete-on-triage.
>
> 3. Self-quoted 'never auto-delete a signal; a human deletes' clause. WORK-CONTRACT.md:70 quotes the phrase as if verbatim canonical text, but `grep` shows the exact wording appears ONLY in that bullet (and in this observation / the originating task). The concept exists in the L72 'discharge it by deleting it' sentence and the bucket table's 'leaves by deletion', but a future reader searching for the quoted clause won't find it. Fix would be: anchor the reference to the actual L72 wording, or introduce the phrase canonically elsewhere.
>
> Observation file: work/notes/observations/review-nits-work-contract-sanction-deletion-on-apply-discharge-2026-06-24.md. All three are explicitly non-blocking; Gate 2 already approved.

_Suggested default: promote-task — a single small cleanup task ('WORK-CONTRACT.md:70 nits: drop `duplicate` from the disposition list, anchor the self-quoted clause to L72; verify `promote-prd` reference is now consistent') captures nits #1 and #3, discharges the note, and drops stale nit #2 in the same motion. Choose `delete` if you judge the wording slips minor enough to live with; `keep` is honest only if you expect another related edit imminently to absorb them._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

promote-task — one small cleanup task on `WORK-CONTRACT.md:70` covering nits #1 + #3 (drop `duplicate` from the disposition list; anchor the self-quoted clause; verify the `promote-prd` reference is consistent) and dropping stale nit #2 in the same motion. Edit the SOURCE `skills/setup/protocol/` + mirror byte-identically into `work/protocol/` per AGENTS.md.
