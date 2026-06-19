# Sidecar `dropped` disposition may still route to the RETIRED flat `work/dropped/`

Noticed 2026-06-19 during the protocol-docs/skills vocabulary cutover.

`packages/agent-runner/src/sidecar.ts` (`SidecarDisposition` doc-comment) still says the
`dropped` disposition "ROUTES the item to `work/dropped/`". But the
`folder-taxonomy-reorg-and-rename` PRD's resolved end-state SPLIT that shared top-level
`work/dropped/` into per-regime terminals (`tasks/cancelled/` for tasks, `briefs/dropped/`
for briefs) precisely to fix a slug-collision, and `brief-regime-rename-and-dropped-migration`
(done) migrated the contents. So the sidecar's `dropped`-routing comment/behaviour may now
point at a folder that no longer exists, OR route a dropped task/brief to the wrong terminal.
The `promote-slice` disposition VALUE also still carries the old `slice` word
(`surface-gate.ts` + `sidecar.ts`), untouched by the vocabulary cutover (which scoped to the
identity/CLI seam, not the sidecar disposition enum). Worth verifying whether the sidecar
routing + the `promote-slice` value need a follow-up to land the per-regime terminals + the
`task` vocabulary. (This slice left both untouched — code constants are out of its
docs/skills scope.)
