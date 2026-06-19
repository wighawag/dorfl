/**
 * Pure slicing-eligibility resolution — the auto-slice decision layer, one level
 * UP from the build gate (`eligibility.ts`). No I/O: callers pass in the PRD's
 * two autonomy axes (`humanOnly`, `needsAnswers`), the repo's `autoSlice` policy,
 * the PRD's `briefAfter` slugs, and the set of slugs whose PRDs are already
 * SLICED (resolved against `work/prd-sliced/` residence, NOT `work/done/`).
 *
 * This mirrors the build-gate shape deliberately (CONTEXT.md / the `auto-slice`
 * PRD): the same `needsAnswers !== true && humanOnly !== true && <repo policy>`
 * predicate, applied to a PRD's two axes + the repo's `autoSlice` toggle — and a
 * cross-PRD ordering check that resolves against sliced-ness rather than done-ness.
 */

import type {HumanOnlyGate} from './eligibility.js';

export type {HumanOnlyGate};

/** Resolution of a PRD's `briefAfter` against the set of already-sliced PRDs. */
export interface SliceAfterResult {
	/** True when every listed PRD is already sliced. */
	satisfied: boolean;
	/** Listed PRD slugs not yet sliced, in declaration order. */
	missing: string[];
}

export interface SlicingEligibilityInput {
	/** Autonomy axis 1 (DECIDED): a human must drive THIS PRD's slicing. */
	humanOnly: HumanOnlyGate;
	/** Autonomy axis 2 (DISCOVERED): the PRD has unresolved questions. */
	needsAnswers: HumanOnlyGate;
	/** Cross-PRD order: PRD slugs that must already be sliced before this one. */
	briefAfter: string[];
	/** Slugs of PRDs that are already SLICED (residence in `work/prd-sliced/`). */
	slicedSlugs: Set<string>;
	/** Per-repo policy: may an agent auto-slice *undeclared* PRDs in this repo? */
	autoSlice: boolean;
	/**
	 * The target was named EXPLICITLY by the operator (`do prd:<slug>`), so the
	 * `autoSlice` POLICY is already satisfied — naming the PRD IS the authorization,
	 * exactly as `do <slice>` builds a named slice regardless of `autoBuild` (the
	 * `autoBuild` precedent: the pool/scan gates the policy, the explicit claim path
	 * never re-checks it). When `true`, the policy term drops from the gate and ONLY
	 * the PRD's own readiness axes (`humanOnly`/`needsAnswers`) + `briefAfter` bind.
	 * Defaults `false` (the AUTO-PICK pool path, where the `autoSlice` policy DOES
	 * gate). The pool is the single policy-enforcement point; the per-invocation gate
	 * applies the policy only when NOT explicit.
	 */
	explicit?: boolean;
}

export interface SlicingEligibilityResult {
	/** Sliceable now = gate passes AND every `briefAfter` PRD is already sliced. */
	sliceable: boolean;
	/** Whether the autonomy gate alone passes (agent-sliceable on its own axes). */
	gatePass: boolean;
	briefAfter: SliceAfterResult;
}

/**
 * Resolve the slicing autonomy gate: agent-sliceable iff `needsAnswers` is not
 * `true` AND `humanOnly` is not `true` AND the repo's `autoSlice` POLICY is
 * satisfied — where the policy is satisfied either by the repo's `autoSlice`
 * toggle being on (the AUTO-PICK pool path) OR by the target being named
 * EXPLICITLY (`explicit: true` — `do prd:<slug>`, where naming IS the
 * authorization, mirroring `do <slice>` vs `autoBuild`). Both readiness axes
 * block orthogonally and are never agent-sliceable regardless of policy; a human
 * is never bound by either. The exact mirror of `resolveGate` (the build gate),
 * one level up.
 */
export function resolveSliceGate(
	humanOnly: HumanOnlyGate,
	needsAnswers: HumanOnlyGate,
	autoSlice: boolean,
	explicit = false,
): boolean {
	if (needsAnswers === true || humanOnly === true) {
		return false;
	}
	// EXPLICIT naming satisfies the policy term (the build path's autoBuild
	// precedent); otherwise the repo's autoSlice toggle gates the auto-pick pool.
	return explicit || autoSlice;
}

/**
 * Resolve a PRD's `briefAfter` against the slugs of PRDs already SLICED (NOT
 * `done/`): satisfied iff every listed PRD is present in `slicedSlugs`. An
 * unsliced blocker ⇒ not yet sliceable (so this PRD's emitted slices can
 * reference the real slugs of those PRDs' slices).
 */
export function resolveSliceAfter(
	briefAfter: string[],
	slicedSlugs: Set<string>,
): SliceAfterResult {
	const missing = briefAfter.filter((slug) => !slicedSlugs.has(slug));
	return {satisfied: missing.length === 0, missing};
}

/** Combine the slicing gate and `briefAfter` resolution into a verdict. */
export function resolveSlicingEligibility(
	input: SlicingEligibilityInput,
): SlicingEligibilityResult {
	const gatePass = resolveSliceGate(
		input.humanOnly,
		input.needsAnswers,
		input.autoSlice,
		input.explicit,
	);
	const briefAfter = resolveSliceAfter(input.briefAfter, input.slicedSlugs);
	return {
		sliceable: gatePass && briefAfter.satisfied,
		gatePass,
		briefAfter,
	};
}
