/**
 * **The shared STAGING/POOL placement resolver** (spec
 * `staging-pool-position-gate-and-trust-model`, task
 * `runner-deterministic-slice-placement-policy-and-precedence`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`).
 *
 * Pure function from UNFORGEABLE inputs to a staging-vs-pool destination:
 *
 *   explicit operator flag  >  configured default  >  built-in
 *
 * Author-trust is NO LONGER a rung here (ADR
 * `untrusted-origin-carries-via-stamp-not-forced-staging`). This resolver was
 * once the POSITIONAL twin of the untrusted-origin BUILD-propose rule in
 * `integration-core.ts` (an `originTrust: untrusted ⇒ staging` rung sitting
 * above the configured default). That rung is REMOVED: it made "untrusted
 * lands in `ready`" inexpressible, and its safety was redundant with the
 * build-time propose rule (an untrusted item in the pool still cannot become
 * merged CODE without human review). The trusted-vs-untrusted destination is
 * now selected BY THE CALLER, which reads the stamp and picks the matching
 * configured default (`untrusted*LandIn` vs `*LandIn`) BEFORE calling — so
 * this resolver stays a pure precedence over caller-supplied inputs. The
 * agent cannot influence placement — it resolves runner-side from the resolved
 * policy + the operator's explicit flag.
 *
 * LIFECYCLE-GENERIC. The folder names + the configured-default value are
 * PARAMETERS (`slots`, `configuredDefault`), so the same resolver serves the
 * TASK lifecycle (`tasksLandIn`: `backlog`/`ready` — the POOL value was
 * renamed `'backlog'` → `'todo'` → `'ready'`, ADR
 * `rename-task-pool-folder-todo-to-ready`) AND the SPEC-
 * placement lifecycle (`specsLandIn`: `proposed`/`ready`) without forking. A future
 * lifecycle (e.g. intake's lone-task) plugs its own `slots` in and reuses the
 * exact precedence — no second implementation.
 */

/**
 * Which side of the staging/pool split the runner chose. The CALLER maps this
 * onto the lifecycle's concrete folder name via {@link PlacementSlots}.
 *
 * - `'staging'` — land in the staging area (tasks: `tasks/backlog/`; prds:
 *   `specs/proposed/`). Not in the agent pool; a human/runner promotion is needed to make
 *   the item eligible. Review-without-PR review surface.
 * - `'pool'` — land directly in the agent-eligible pool (tasks: `tasks/ready/`;
 *   prds: `specs/ready/`). The trusted-fast-path landing.
 */
export type PlacementSide = 'staging' | 'pool';

/**
 * The two folder names a lifecycle uses for its staging/pool split. Supplied by
 * the caller so this resolver stays lifecycle-generic (the TASK caller passes
 * `{staging: 'tasks/backlog', pool: 'tasks/ready'}`; the SPEC-placement caller passes
 * `{staging: 'specs/proposed', pool: 'specs/ready'}`).
 */
export interface PlacementSlots {
	staging: string;
	pool: string;
}

/** Inputs to {@link resolvePlacement}, in the precedence chain's order. */
export interface ResolvePlacementInput {
	/**
	 * The operator's EXPLICIT override (the TOP of the chain) — when set, it
	 * wins over the configured default. Mirrors `integration-core.ts`'s
	 * `explicitMerge` "operator is present; CLI always wins, no special
	 * force-key" shape. Unset (`undefined`) ⇒ this rung is skipped and the next
	 * one applies.
	 */
	explicit?: PlacementSide;
	/**
	 * The repo's resolved configured DEFAULT landing, ALREADY selected by the
	 * caller for the item's author-trust: the caller reads the `originTrust:`
	 * stamp and passes the `untrusted*LandIn` default for an untrusted item, or
	 * the trusted `*LandIn` default otherwise (ADR
	 * `untrusted-origin-carries-via-stamp-not-forced-staging`). Resolved like the
	 * existing `taskingIntegration` (flag > env > per-repo > global > built-in)
	 * and mapped to a {@link PlacementSide}; this resolver just consumes it. Unset
	 * ⇒ the built-in floor applies.
	 */
	configuredDefault?: PlacementSide;
}

/**
 * The resolved choice + which precedence rung won (for honest reporting).
 *
 * The `'untrusted-origin'` reason is RETIRED (ADR
 * `untrusted-origin-carries-via-stamp-not-forced-staging`): author-trust no
 * longer decides POSITION inside this resolver, so an untrusted item that lands
 * in staging now does so via `'configured-default'` (its caller selected the
 * `untrusted*LandIn` default), not via a distinct trust rung.
 */
export interface PlacementResult {
	choice: PlacementSide;
	reason: 'explicit' | 'configured-default' | 'built-in';
}

/**
 * The BUILT-IN floor (the LOWEST rung): land in STAGING. Conservative — a new
 * lifecycle that has not configured a landing yet stays gated by a human/runner
 * promotion, never silently auto-eligible. The tracer task
 * `pre-backlog-staging-folder-and-promote-step-a` also lands staged, so this
 * preserves zero behaviour change for repos that do not opt into a default.
 */
const BUILT_IN_FLOOR: PlacementSide = 'staging';

/**
 * Resolve the staging-vs-pool placement from unforgeable inputs, via the fixed
 * precedence chain:
 *
 *   explicit  >  configured default  >  built-in
 *
 * Pure: no I/O, no env reads, NO trust rung — the caller resolves config
 * (INCLUDING selecting the trusted-vs-untrusted default from the stamp) and
 * passes the result in. Reused by every lifecycle (task + spec placement +
 * future intake variants) so a precedence change touches ONE place.
 */
export function resolvePlacement(
	input: ResolvePlacementInput,
): PlacementResult {
	if (input.explicit !== undefined) {
		return {choice: input.explicit, reason: 'explicit'};
	}
	if (input.configuredDefault !== undefined) {
		return {choice: input.configuredDefault, reason: 'configured-default'};
	}
	return {choice: BUILT_IN_FLOOR, reason: 'built-in'};
}

/**
 * Map a resolved {@link PlacementSide} onto the lifecycle's concrete folder
 * name. The caller passes its lifecycle slots; this is sugar so the call site
 * does not re-`if`-ladder the side ↔ folder mapping.
 */
export function placementFolder(
	slots: PlacementSlots,
	choice: PlacementSide,
): string {
	return choice === 'staging' ? slots.staging : slots.pool;
}
