---
'dorfl': patch
---

In a fresh clone whose `dorflCmd` points at a not-yet-installed binary (e.g. `node_modules/.bin/dorfl`), help and version requests (`dorfl`, `dorfl help ...`, `... --help`, `-h`, `--version`) fall back to the dorfl on PATH with a notice that its help may differ from the pinned version. Every other command still fails loud with the install-first error.
