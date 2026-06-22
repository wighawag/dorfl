/**
 * **The shared STAGING/POOL placement resolver** (PRD
 * `staging-pool-position-gate-and-trust-model`, slice
 * `runner-deterministic-slice-placement-policy-and-precedence`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`).
 *
 * Pure function from UNFORGEABLE inputs to a staging-vs-pool destination:
 *
 *   explicit operator flag  >  untrusted-origin forces STAGING  >
 *     configured default  >  built-in
 *
 * It is the POSITIONAL twin of the untrusted-origin BUILD-propose rule in
 * `integration-core.ts` (which decides MODE: `propose` vs `merge`): the same
 * `originTrust:` stamp + the same "explicit operator override beats the trust
 * force" shape, reused here to decide POSITION (which folder the runner lands
 * the emitted ledger files in). The agent cannot influence either — both
 * resolve runner-side from the stamped frontmatter + the resolved policy + the
 * operator's explicit flag.
 *
 * LIFECYCLE-GENERIC. The folder names + the configured-default value are
 * PARAMETERS (`slots`, `configuredDefault`), so the same resolver serves the
 * TASK lifecycle (`tasksLandIn`: `pre-backlog`/`todo` — the POOL value was
 * renamed from `'backlog'` in slice
 * `f1-pool-noun-todo-in-surface-and-apply-readers`) AND the BRIEF-
 * placement slice (`briefsLandIn`: `pre-proposed`/`ready`) without forking. A future
 * lifecycle (e.g. intake's lone-slice) plugs its own `slots` in and reuses the
 * exact precedence — no second implementation.
 */

/**
 * Which side of the staging/pool split the runner chose. The CALLER maps this
 * onto the lifecycle's concrete folder name via {@link PlacementSlots}.
 *
 * - `'staging'` — land in the staging area (slices: `pre-backlog/`; PRDs:
 *   `prd/`). Not in the agent pool; a human/runner promotion is needed to make
 *   the item eligible. Review-without-PR review surface.
 * - `'pool'` — land directly in the agent-eligible pool (slices: `tasks/todo/`;
 *   PRDs: `prd-ready/`). The trusted-fast-path landing.
 */
export type PlacementSide = 'staging' | 'pool';

/**
 * The two folder names a lifecycle uses for its staging/pool split. Supplied by
 * the caller so this resolver stays lifecycle-generic (the SLICE caller passes
 * `{staging: 'pre-backlog', pool: 'tasks/todo'}`; the PRD-placement caller passes
 * `{staging: 'prd', pool: 'prd-ready'}`).
 */
export interface PlacementSlots {
	staging: string;
	pool: string;
}

/** Inputs to {@link resolvePlacement}, in the precedence chain's order. */
export interface ResolvePlacementInput {
	/**
	 * The operator's EXPLICIT override (the TOP of the chain) — when set, it
	 * wins over the untrusted-origin force AND the configured default. Mirrors
	 * `integration-core.ts`'s `explicitMerge` "operator is present; CLI always
	 * wins, no special force-key" shape (the untrusted-origin trust signal
	 * gates pool entry, not the mode in this case). Unset (`undefined`) ⇒ this
	 * rung is skipped and the next one applies.
	 */
	explicit?: PlacementSide;
	/**
	 * The source's stamped `originTrust:` frontmatter (`trusted` | `untrusted` |
	 * absent ⇒ trusted by default). When `untrusted`, the resolver FORCES
	 * `staging` even on a "land in pool" repo — the positional analogue of the
	 * existing `untrusted-origin-forces-build-propose` rule. Unset / `trusted`
	 * ⇒ this rung is skipped (zero behaviour change for the normal path).
	 */
	originTrust?: 'trusted' | 'untrusted';
	/**
	 * The repo's resolved configured DEFAULT landing (`tasksLandIn` /
	 * `briefsLandIn`). Caller resolves it like the existing `taskingIntegration`
	 * (flag > env > per-repo > global > built-in) and passes the result; this
	 * resolver just consumes it.
	 */
	configuredDefault?: PlacementSide;
}

/** The resolved choice + which precedence rung won (for honest reporting). */
export interface PlacementResult {
	choice: PlacementSide;
	reason: 'explicit' | 'untrusted-origin' | 'configured-default' | 'built-in';
}

/**
 * The BUILT-IN floor (the LOWEST rung): land in STAGING. Conservative — a new
 * lifecycle that has not configured a landing yet stays gated by a human/runner
 * promotion, never silently auto-eligible. The tracer slice
 * `pre-backlog-staging-folder-and-promote-step-a` also lands staged, so this
 * preserves zero behaviour change for repos that do not opt into a default.
 */
const BUILT_IN_FLOOR: PlacementSide = 'staging';

/**
 * Resolve the staging-vs-pool placement from unforgeable inputs, via the fixed
 * precedence chain:
 *
 *   explicit  >  untrusted-origin ⇒ staging  >  configured default  >  built-in
 *
 * Pure: no I/O, no env reads — the caller resolves config + reads the
 * frontmatter and passes both in. Reused by every lifecycle (slice + PRD
 * placement + future intake variants) so a precedence change touches ONE place.
 */
export function resolvePlacement(
	input: ResolvePlacementInput,
): PlacementResult {
	if (input.explicit !== undefined) {
		return {choice: input.explicit, reason: 'explicit'};
	}
	if (input.originTrust === 'untrusted') {
		return {choice: 'staging', reason: 'untrusted-origin'};
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
