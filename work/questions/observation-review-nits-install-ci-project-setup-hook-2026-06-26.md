<!-- dorfl-sidecar: item=observation:review-nits-install-ci-project-setup-hook-2026-06-26 type=observation slug=review-nits-install-ci-project-setup-hook-2026-06-26 allAnswered=false -->

## Q1

**What should happen to this observation — ratify the seven listed in-scope decisions (a-g) and discharge, promote to a follow-up task (e.g. backfill a Decisions block into the done record, or revisit any decision you disagree with), or delete as a spent nit?**

> work/notes/observations/review-nits-install-ci-project-setup-hook-2026-06-26.md carries Gate-2 non-blocking nits for install-ci-project-setup-hook (approved, integrated). It enumerates seven decisions the agent took in-scope: (a) config-key shape projectSetup:{<provider>:<payload>}; (b) split of light structural check — outer map in core loadCIConfigFile, per-payload list-of-mappings in adapter validateGithubProjectSetupPayload; (c) new CIProviderContext seams providerId + optional renderProjectSetup(payload) (cross-cutting for future adapters); (d) exported error class GithubProjectSetupError; (e) --export-config OMITS projectSetup when absent or {}; (f) empty/whitespace-only payload STRING is rejected (task said absent/empty ⇒ byte-identical; agent read empty at map level as {}, string payload as user intent); (g) validator strips leading/trailing whitespace from payload before splicing. The task prompt asked for a ## Decisions block in the done record / PR; work/tasks/done/install-ci-project-setup-hook.md has none, and the commit body is empty — so these decisions are only recorded in this observation. Related sibling nits already have sidecars (tier1-branch-protection has one; document-toolchain-boundary and prefer-project-local-dorfl are peers still open).

_Suggested default: Ratify all seven and discharge; if the missing Decisions block matters as a repeat pattern, that concern already has its own observation (decisions-block-convention-repeatedly-skipped-2026-06-22) — don't duplicate here._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
