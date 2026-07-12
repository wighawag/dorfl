<!-- dorfl-sidecar: item=observation:promote-cli-prose-still-says-pre-backlog-2026-07-11 type=observation slug=promote-cli-prose-still-says-pre-backlog-2026-07-11 allAnswered=false -->

Item: [`observation:promote-cli-prose-still-says-pre-backlog-2026-07-11`](../notes/observations/promote-cli-prose-still-says-pre-backlog-2026-07-11.md)

## Q1

**Does the follow-up sweep also rename the `--tasks-land-in <pre-backlog|ready>` accepted-value spelling (which cascades into env-config enum, `tasksLandIn` config, and `tasking.ts` union types), or is `pre-backlog` retained as a STABLE UX/config token while only user-visible PROSE is updated?**

> The observation flags `--tasks-land-in <pre-backlog|ready>` prose ('if that noun is also being retired') as ambiguous. `pre-backlog` currently appears as an enum value in env-config.ts:108, a repo-config option, and the `tasksLandIn` union in tasking.ts:273/283 — retiring it is a breaking config/env-var change, not a prose sweep. The two possible scopes have very different blast radii.

_Suggested default: Keep `pre-backlog` as the stable flag/config token (it is the semantic name of the staged-landing mode); sweep ONLY the prose that talks about on-disk paths (`work/pre-backlog/` → `work/tasks/backlog/`, `work/backlog/` → `work/tasks/ready/`) through `workFolderPrefix('tasks-backlog'|'tasks-ready')`._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Should the sweep additionally cover the OTHER cli.ts sites that still hardcode `work/backlog/` in user-visible prose (claim ~L1520, prompt ~L1793, from-issue ~L3828, remote-scan ~L4176), or is the follow-up strictly scoped to the `promote` verb wiring (description ~L3587, comment ~L3574, empty-list message ~L3615) called out in the observation body?**

> The observation body names ONLY the promote-verb call sites, but grep shows ~4 other cli.ts descriptions still saying `work/backlog/<slug>.md` where the live layout is `work/tasks/ready/`. Bundling them yields one coherent noun-sweep; excluding them leaves visible drift that will re-surface as another observation.

_Suggested default: Bundle all cli.ts user-facing prose that names `work/backlog/` or `work/pre-backlog/` into the one sweep, routed through `workFolderPrefix`, since they share the same stale-noun root cause._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
