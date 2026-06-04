/**
 * Pure eligibility resolution. No I/O — callers pass in the `humanOnly` value,
 * the item's `blocked_by` slugs, and the set of slugs present in the same repo's
 * `work/done/`. Dependencies are per-repo only and never cross repos.
 */

/**
 * The slice autonomy gate. `true` ⇒ the slice declares itself human-only (never
 * auto-claim); `undefined` ⇒ undeclared (most slices). Authoritative + binary.
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
 * Resolve the autonomy gate: agent-claimable iff `humanOnly` is not `true` AND
 * the repo's `allowAgents` policy is on. `humanOnly: true` is never claimable
 * regardless of policy.
 */
export function resolveGate(
	humanOnly: HumanOnlyGate,
	allowAgents: boolean,
): boolean {
	if (humanOnly === true) {
		return false;
	}
	return allowAgents;
}

/** Resolve `blocked_by` against the slugs present in `work/done/`. */
export function resolveBlockedBy(
	blockedBy: string[],
	doneSlugs: Set<string>,
): BlockedByResult {
	const missing = blockedBy.filter((slug) => !doneSlugs.has(slug));
	return {satisfied: missing.length === 0, missing};
}

/** Combine the autonomy gate and `blocked_by` resolution into a verdict. */
export function resolveEligibility(input: EligibilityInput): EligibilityResult {
	const gatePass = resolveGate(input.humanOnly, input.allowAgents);
	const blockedBy = resolveBlockedBy(input.blockedBy, input.doneSlugs);
	return {
		eligible: gatePass && blockedBy.satisfied,
		gatePass,
		blockedBy,
	};
}
