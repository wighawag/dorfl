# `do --allow-backlog` tells the build agent the task is in `tasks/ready/` and the spec in `specs/ready/`

Date: 2026-09-29
Observer: conductor of a drive-tasks run over wighawag/serpcast (dorfl 0.14.3), drive-from-backlog mode.

Every build dispatched with `dorfl do task:<slug> --isolated --allow-backlog` got a runner prompt pointing at `work/tasks/ready/<slug>.md` and `work/specs/ready/<spec>.md`, while in the job worktree the task body rested in `work/tasks/backlog/` and the spec in `work/specs/tasked/`. The content matched, so the builds went ahead, but 8 of 9 build agents stopped to notice and each wrote a `*-launched-from-backlog.md` observation into the target repo (removed there by hand afterwards, pointing here). The prompt should name the path the body was actually resolved from (the `--allow-backlog` resolution already knows it), and the spec path should come from the spec's actual folder rather than an assumed `specs/ready/`. The done-move itself was correct (`backlog/ -> done/`).
