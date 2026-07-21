# Pending changeset still mentions the placeholder `dorflBin`

2026-07-21 — `.changeset/setup-nudges-dorfl-version-pin.md` (from the done task
`setup-nudges-dorfl-version-pin`) ends with "Forward-compatible with a future
`dorflBin` pin field in `dorfl.json`". The field actually shipped as **`dorflCmd`**
(a command string, not a bare version) via `dorfl-cmd-config-field` +
`dorfl-bootstrap-self-forward`. That changeset is still unreleased, so on the next
release the published changelog will name a placeholder (`dorflBin`) that never
existed. Noticed while documenting `dorflCmd` (task `dorfl-cmd-docs-and-upgrade-ritual`,
which updated the setup nudge itself to `dorflCmd`). Left unchanged here — editing
another task's changeset is outside this task's scope.
