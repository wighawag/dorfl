/**
 * Pure slicing-eligibility resolution — the auto-slice decision layer, one level
 * UP from the build gate (`eligibility.ts`). No I/O: callers pass in the PRD's
 * two autonomy axes (`humanOnly`, `needsAnswers`), the repo's `autoSlice` policy,
 * the PRD's `sliceAfter` slugs, and the set of slugs whose PRDs are already
 * SLICED (resolved against the `sliced:` marker, NOT `work/done/`).
 *
 * This mirrors the build-gate shape deliberately (CONTEXT.md / the `auto-slice`
 * PRD): the same `needsAnswers !== true && humanOnly !== true && <repo policy>`
 * predicate, applied to a PRD's two axes + the repo's `autoSlice` toggle — and a
 * cross-PRD ordering check that resolves against sliced-ness rather than done-ness.
 */

import type {HumanOnlyGate} from './eligibility.js';

export type {HumanOnlyGate};

/** Resolution of a PRD's `sliceAfter` against the set of already-sliced PRDs. */
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
	sliceAfter: string[];
	/** Slugs of PRDs that are already SLICED (their `sliced:` marker is set). */
	slicedSlugs: Set<string>;
	/** Per-repo policy: may an agent auto-slice *undeclared* PRDs in this repo? */
	autoSlice: boolean;
}

export interface SlicingEligibilityResult {
	/** Sliceable now = gate passes AND every `sliceAfter` PRD is already sliced. */
	sliceable: boolean;
	/** Whether the autonomy gate alone passes (agent-sliceable on its own axes). */
	gatePass: boolean;
	sliceAfter: SliceAfterResult;
}

/**
 * Resolve the slicing autonomy gate: agent-sliceable iff `needsAnswers` is not
 * `true` AND `humanOnly` is not `true` AND the repo's `autoSlice` policy is on.
 * Both axes block orthogonally and are never agent-sliceable regardless of
 * policy; a human is never bound by either. The exact mirror of `resolveGate`
 * (the build gate), one level up.
 */
export function resolveSliceGate(
	humanOnly: HumanOnlyGate,
	needsAnswers: HumanOnlyGate,
	autoSlice: boolean,
): boolean {
	if (needsAnswers === true || humanOnly === true) {
		return false;
	}
	return autoSlice;
}

/**
 * Resolve a PRD's `sliceAfter` against the slugs of PRDs already SLICED (NOT
 * `done/`): satisfied iff every listed PRD is present in `slicedSlugs`. An
 * unsliced blocker ⇒ not yet sliceable (so this PRD's emitted slices can
 * reference the real slugs of those PRDs' slices).
 */
export function resolveSliceAfter(
	sliceAfter: string[],
	slicedSlugs: Set<string>,
): SliceAfterResult {
	const missing = sliceAfter.filter((slug) => !slicedSlugs.has(slug));
	return {satisfied: missing.length === 0, missing};
}

/** Combine the slicing gate and `sliceAfter` resolution into a verdict. */
export function resolveSlicingEligibility(
	input: SlicingEligibilityInput,
): SlicingEligibilityResult {
	const gatePass = resolveSliceGate(
		input.humanOnly,
		input.needsAnswers,
		input.autoSlice,
	);
	const sliceAfter = resolveSliceAfter(input.sliceAfter, input.slicedSlugs);
	return {
		sliceable: gatePass && sliceAfter.satisfied,
		gatePass,
		sliceAfter,
	};
}
