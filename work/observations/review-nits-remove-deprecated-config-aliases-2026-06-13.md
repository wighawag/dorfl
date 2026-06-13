---
title: review-gate non-blocking nits for 'remove-deprecated-config-aliases' (Gate 2 approve)
date: 2026-06-13
status: open
slug: remove-deprecated-config-aliases
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'remove-deprecated-config-aliases' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: `config-alias.ts` was DELETED entirely rather than kept as an empty-registry scaffold for the next rename. OK to confirm this as the chosen disposition?
  (The slice's Decisions block explicitly asked the builder to record this choice and recommended deletion as cleanest (given the 'no alias while no external users' stance), so this is the expected option, not a surprise. Recording it here for the human to ratify since it is the one structural either/or the slice flagged. Re-introducing an alias later is a cheap, well-understood operation (the git history of `config-alias.ts` is the template).)
- Ratify: the injectable `warn` callback parameter was removed from `loadConfig`, `envOverrides`, and `autoBuildFromCli` (signature narrowing), not just left unused. OK?
  (These three functions previously took a `warn` callback SOLELY to emit the alias deprecation message. With the alias gone the parameter is dead, so the builder removed it rather than leaving an unused seam (consistent with the slice's 'remove dead code, do not leave unused exports' instruction). All call sites in `src/` and `test/` were updated; a grep confirms no caller still passes a second `warn` argument to any of the three. This slightly exceeds a literal 'delete the alias entry' into 'delete the warn-injection seam', so it is worth a human nod. Reversible if a future feature needs injectable warnings on these functions.)
