/**
 * Pure eligibility resolution. No I/O — callers pass in the two autonomy axes
 * (`humanOnly`, `needsAnswers`), the item's `blockedBy` slugs, and the set of
 * slugs present in the same repo's `work/done/`. Dependencies are per-repo only
 * and never cross repos.
 */

/**
 * An autonomy gate axis. `true` ⇒ the item is gated on this axis (never
 * auto-claim); `undefined`/`false` ⇒ not gated on it. Both `humanOnly` (DECIDED)
 * and `needsAnswers` (DISCOVERED) share this shape and block orthogonally.
 */
export type HumanOnlyGate = boolean | undefined;

export interface BlockedByResult {
	/** True when every blocker is present in `work/done/`. */
	satisfied: boolean;
	/** Blocker slugs not yet in `work/done/`, in declaration order. */
	missing: string[];
}

export interface EligibilityInput {
	humanOnly: HumanOnlyGate;
	needsAnswers: HumanOnlyGate;
	blockedBy: string[];
	/** Slugs present in this repo's `work/done/`. */
	doneSlugs: Set<string>;
	/** Per-repo policy: may agents claim *undeclared* (not human-only) slices? */
	allowAgents: boolean;
}

export interface EligibilityResult {
	/** Eligible now = gate passes AND all blockers satisfied. */
	eligible: boolean;
	/** Whether the autonomy gate alone passes (agent-claimable). */
	gatePass: boolean;
	blockedBy: BlockedByResult;
}

/**
 * Resolve the autonomy gate: agent-claimable iff `needsAnswers` is not `true`
 * AND `humanOnly` is not `true` AND the repo's `allowAgents` policy is on. Both
 * axes block orthogonally and are never claimable by an agent regardless of
 * policy; a human is never bound by either.
 */
export function resolveGate(
	humanOnly: HumanOnlyGate,
	needsAnswers: HumanOnlyGate,
	allowAgents: boolean,
): boolean {
	if (needsAnswers === true || humanOnly === true) {
		return false;
	}
	return allowAgents;
}

/** Resolve `blockedBy` against the slugs present in `work/done/`. */
export function resolveBlockedBy(
	blockedBy: string[],
	doneSlugs: Set<string>,
): BlockedByResult {
	const missing = blockedBy.filter((slug) => !doneSlugs.has(slug));
	return {satisfied: missing.length === 0, missing};
}

/** Combine the autonomy gate and `blockedBy` resolution into a verdict. */
export function resolveEligibility(input: EligibilityInput): EligibilityResult {
	const gatePass = resolveGate(
		input.humanOnly,
		input.needsAnswers,
		input.allowAgents,
	);
	const blockedBy = resolveBlockedBy(input.blockedBy, input.doneSlugs);
	return {
		eligible: gatePass && blockedBy.satisfied,
		gatePass,
		blockedBy,
	};
}
