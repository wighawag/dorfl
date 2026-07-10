/**
 * Pure tasking-eligibility resolution — the auto-task decision layer, one level
 * UP from the build gate (`eligibility.ts`). No I/O: callers pass in the spec's
 * two autonomy axes (`humanOnly`, `needsAnswers`), the repo's `autoTask` policy,
 * the spec's `taskedAfter` slugs, and the set of slugs whose prds are already
 * TASKED (resolved against `work/specs/tasked/` residence, NOT `work/done/`).
 *
 * This mirrors the build-gate shape deliberately (CONTEXT.md / the `auto-slice`
 * spec): the same `needsAnswers !== true && humanOnly !== true && <repo policy>`
 * predicate, applied to a spec's two axes + the repo's `autoTask` toggle — and a
 * cross-spec ordering check that resolves against tasked-ness rather than done-ness.
 */

import type {HumanOnlyGate} from './eligibility.js';

export type {HumanOnlyGate};

/** Resolution of a spec's `taskedAfter` against the set of already-tasked prds. */
export interface TaskedAfterResult {
	/** True when every listed spec is already tasked. */
	satisfied: boolean;
	/** Listed spec slugs not yet tasked, in declaration order. */
	missing: string[];
}

export interface TaskingEligibilityInput {
	/** Autonomy axis 1 (DECIDED): a human must drive THIS spec's tasking. */
	humanOnly: HumanOnlyGate;
	/** Autonomy axis 2 (DISCOVERED): the spec has unresolved questions. */
	needsAnswers: HumanOnlyGate;
	/** Cross-spec order: spec slugs that must already be tasked before this one. */
	taskedAfter: string[];
	/** Slugs of prds that are already TASKED (residence in `work/specs/tasked/`). */
	taskedSlugs: Set<string>;
	/** Per-repo policy: may an agent auto-task *undeclared* prds in this repo? */
	autoTask: boolean;
	/**
	 * The target was named EXPLICITLY by the operator (`do spec:<slug>`), so the
	 * `autoTask` POLICY is already satisfied — naming the spec IS the authorization,
	 * exactly as `do <task>` builds a named task regardless of `autoBuild` (the
	 * `autoBuild` precedent: the pool/scan gates the policy, the explicit claim path
	 * never re-checks it). When `true`, the policy term drops from the gate and ONLY
	 * the spec's own readiness axes (`humanOnly`/`needsAnswers`) + `taskedAfter` bind.
	 * Defaults `false` (the AUTO-PICK pool path, where the `autoTask` policy DOES
	 * gate). The pool is the single policy-enforcement point; the per-invocation gate
	 * applies the policy only when NOT explicit.
	 */
	explicit?: boolean;
}

export interface TaskingEligibilityResult {
	/** Taskable now = gate passes AND every `taskedAfter` spec is already tasked. */
	taskable: boolean;
	/** Whether the autonomy gate alone passes (agent-taskable on its own axes). */
	gatePass: boolean;
	taskedAfter: TaskedAfterResult;
}

/**
 * Resolve the tasking autonomy gate: agent-taskable iff `needsAnswers` is not
 * `true` AND `humanOnly` is not `true` AND the repo's `autoTask` POLICY is
 * satisfied — where the policy is satisfied either by the repo's `autoTask`
 * toggle being on (the AUTO-PICK pool path) OR by the target being named
 * EXPLICITLY (`explicit: true` — `do spec:<slug>`, where naming IS the
 * authorization, mirroring `do <task>` vs `autoBuild`). Both readiness axes
 * block orthogonally and are never agent-taskable regardless of policy; a human
 * is never bound by either. The exact mirror of `resolveGate` (the build gate),
 * one level up.
 */
export function resolveTaskGate(
	humanOnly: HumanOnlyGate,
	needsAnswers: HumanOnlyGate,
	autoTask: boolean,
	explicit = false,
): boolean {
	if (needsAnswers === true || humanOnly === true) {
		return false;
	}
	// EXPLICIT naming satisfies the policy term (the build path's autoBuild
	// precedent); otherwise the repo's autoTask toggle gates the auto-pick pool.
	return explicit || autoTask;
}

/**
 * Resolve a spec's `taskedAfter` against the slugs of prds already TASKED (NOT
 * `done/`): satisfied iff every listed spec is present in `taskedSlugs`. An
 * untasked blocker ⇒ not yet taskable (so this spec's emitted tasks can
 * reference the real slugs of those prds' tasks).
 */
export function resolveTaskedAfter(
	taskedAfter: string[],
	taskedSlugs: Set<string>,
): TaskedAfterResult {
	const missing = taskedAfter.filter((slug) => !taskedSlugs.has(slug));
	return {satisfied: missing.length === 0, missing};
}

/** Combine the tasking gate and `taskedAfter` resolution into a verdict. */
export function resolveTaskingEligibility(
	input: TaskingEligibilityInput,
): TaskingEligibilityResult {
	const gatePass = resolveTaskGate(
		input.humanOnly,
		input.needsAnswers,
		input.autoTask,
		input.explicit,
	);
	const taskedAfter = resolveTaskedAfter(input.taskedAfter, input.taskedSlugs);
	return {
		taskable: gatePass && taskedAfter.satisfied,
		gatePass,
		taskedAfter,
	};
}
