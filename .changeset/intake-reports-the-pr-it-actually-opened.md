---
'dorfl': patch
---

A propose land no longer claims a PR it did not open. When the provider could not open one (for example a repository that refuses PR creation by GitHub Actions), every land (build, tasking, intake, recovery) now logs `No PR was opened for <branch>` followed by the provider's instruction (the real `gh` error and the manual `gh pr create` command). Intake and tasking say they pushed the work on the branch but opened no PR, the CI build apply reports the same instead of "pushed for review", and intake's completion comment on the issue names the pushed branch, says no PR could be opened and quotes the reason, instead of reading as if a PR carried the artifact. A successful PR creation is reported exactly as before.
