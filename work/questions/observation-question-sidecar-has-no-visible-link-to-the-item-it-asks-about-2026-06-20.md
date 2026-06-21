<!-- agent-runner-sidecar: item=observation:question-sidecar-has-no-visible-link-to-the-item-it-asks-about-2026-06-20 type=observation slug=question-sidecar-has-no-visible-link-to-the-item-it-asks-about-2026-06-20 allAnswered=false -->

## Q1

**How should this observation be triaged — promote it to a slice (spec a task to add a visible Markdown back-link to sidecars), promote-adr (record a decision about whether/how to expose a visible item link given the identity-keyed, folder-move-tolerant design), keep it as a standing observation, or drop/delete it?**

> Observation notes that sidecars (`work/questions/<type>-<slug>.md`) currently identify their item ONLY via an HTML comment (`<!-- agent-runner-sidecar: item=… -->`), which GitHub and VSCode render as nothing. Humans reading a sidecar on the GitHub web UI (the ADR `question-sidecar-human-readable-format`'s stated primary surface) have no clickable way to jump to the task/brief/observation being asked about and must reconstruct the path manually. The observation explicitly calls itself a 'readability ENHANCEMENT, not a bug' and flags one non-trivial design wrinkle the human must weigh before promotion: items MOVE between lifecycle folders (`tasks/backlog ↔ todo ↔ done ↔ cancelled`, briefs similarly) and the sidecar is identity-keyed precisely so it survives those moves without lockstep — so a static relative link would go stale on the next `git mv`. The observation lists three candidate mitigations (re-render link at each serialise and accept resting staleness that self-heals on next write; link to a stable folder-independent locator; or 'best-effort + may have moved' note) but does NOT pick one. Any chosen link must also stay OUTSIDE per-entry parse regions (like the identity comment is) so it degrades to harmless text and preserves the model-equal round-trip.

_Suggested default: promote-slice — the readability win is cheap and high-leverage on the answer loop's primary human surface, and the staleness wrinkle has a tractable default (re-render on serialise, self-heal on next write); the slice spec is the right place to pin down which of the three mitigation options to take._

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):
