/**
 * Pure eligibility resolution. No I/O — callers pass in the `afk` value, the
 * item's `blocked_by` slugs, and the set of slugs present in the same repo's
 * `work/done/`. Dependencies are per-repo only and never cross repos.
 */

/** Three-state representation of the `afk` gate. `true` | `false` | `undefined`. */
export type AfkGate = boolean | undefined;

export interface BlockedByResult {
	/** True when every blocker is present in `work/done/`. */
	satisfied: boolean;
	/** Blocker slugs not yet in `work/done/`, in declaration order. */
	missing: string[];
}

export interface EligibilityInput {
	afk: AfkGate;
	blockedBy: string[];
	/** Slugs present in this repo's `work/done/`. */
	doneSlugs: Set<string>;
	allowUnspecifiedGate: boolean;
}

export interface EligibilityResult {
	/** Eligible now = AFK gate passes AND all blockers satisfied. */
	eligible: boolean;
	/** Whether the AFK gate alone passes. */
	afkPass: boolean;
	blockedBy: BlockedByResult;
}

/**
 * Resolve the AFK gate: `true` ⇒ eligible; `false` ⇒ never; omitted ⇒ depends on
 * the runner's `allowUnspecifiedGate` policy.
 */
export function resolveAfkGate(
	afk: AfkGate,
	allowUnspecifiedGate: boolean,
): boolean {
	if (afk === true) {
		return true;
	}
	if (afk === false) {
		return false;
	}
	return allowUnspecifiedGate;
}

/** Resolve `blocked_by` against the slugs present in `work/done/`. */
export function resolveBlockedBy(
	blockedBy: string[],
	doneSlugs: Set<string>,
): BlockedByResult {
	const missing = blockedBy.filter((slug) => !doneSlugs.has(slug));
	return {satisfied: missing.length === 0, missing};
}

/** Combine the AFK gate and `blocked_by` resolution into an eligibility verdict. */
export function resolveEligibility(input: EligibilityInput): EligibilityResult {
	const afkPass = resolveAfkGate(input.afk, input.allowUnspecifiedGate);
	const blockedBy = resolveBlockedBy(input.blockedBy, input.doneSlugs);
	return {
		eligible: afkPass && blockedBy.satisfied,
		afkPass,
		blockedBy,
	};
}
