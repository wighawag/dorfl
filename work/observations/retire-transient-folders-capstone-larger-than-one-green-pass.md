# Capstone `retire-transient-folders-and-drop-rebase` is larger than its one-pass estimate

2026-06-18 — While scoping slice `retire-transient-folders-and-drop-rebase`, the
consumer/test surface measured materially larger than the slice's "~25 tests"
estimate: **91 of 170 test files** reference the four transient folders
(`in-progress`/`needs-attention`/`slicing`/`advancing`) or drop-rebase, because
`in-progress/`/`needs-attention/` are woven through nearly every command's tests
(`complete`, `start`, `run`, `do`, `integration-core`, `requeue`, `status`,
`scan`, …), not just the four lock writers.

Separately, `needs-attention/` is NOT a thin marker like `slicing/`/`advancing/`:
slice #6 (`needs-attention-as-stuck-lock-state`) deliberately landed the
`needs-attention/` FOLDER move as the AUTHORITATIVE stuck record (see
`ledger-write.ts` `markStuckLockBestEffort` doc + lines ~798/838/846), with the
lock `state:stuck` mark as a redundant best-effort mirror. Retiring the folder
needs a design decision the slice does not pin: where the stuck item's BODY (the
reason prose lives in the moved `.md` today) and the human RECOVERY view
(`requeue`/`resume`/`continue`/`complete --from-needs-attention`/`status`/`scan`,
which all read `work/needs-attention/<slug>.md`) live once the folder is gone.
The lock entry carries `reason` but not the body/wip.

Signal: the capstone likely wants sub-slicing one consumer-family per slice
(claim-body-stay + complete/integration-core source axis; the needs-attention →
stuck-lock recovery surface; the slicing/advancing marker retirement + folder-set
trim; the drop-rebase deletion + plain-rebase proof). Routed to needs-attention
with a sub-slicing proposal in the slice-stop report.
