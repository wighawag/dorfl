/**
 * Pure categorisation of backlog items into the three "who can take it" groups
 * used by the human decision dashboard. This is deliberately INDEPENDENT of the
 * runner's `allowUnspecifiedGate` policy: a human always sees the full picture
 * (all three groups), and the flag only changes the eligibility *verdict* /
 * summary counts elsewhere — never which group an item lands in.
 */

import type {ScannedItem} from './scan.js';

/**
 * Which group an item belongs to, derived solely from its `afk` gate:
 *   - `runner-eligible` — `afk: true`: an autonomous runner can claim it (now,
 *     if its deps are also satisfied).
 *   - `if-allowed` — gate unspecified (no `afk`): a runner would claim it only
 *     under `allowUnspecifiedGate` / `--allow-unspecified-gate`.
 *   - `human-only` — `afk: false`: a human decides/builds it; a runner never
 *     claims it.
 */
export type Category = 'runner-eligible' | 'if-allowed' | 'human-only';

/** Stable display order for the three groups. */
export const CATEGORY_ORDER: Category[] = [
	'runner-eligible',
	'if-allowed',
	'human-only',
];

/** Human-facing section headings for each group. */
export const CATEGORY_LABELS: Record<Category, string> = {
	'runner-eligible': 'Runner-eligible now (autonomous can claim)',
	'if-allowed':
		'Claimable if allowed (unspecified gate; needs --allow-unspecified-gate)',
	'human-only': 'Human-only (afk:false — a human decides/builds)',
};

/**
 * Map an `afk` gate to its dashboard category. Flag-independent by design:
 * the category reflects the gate the author wrote, not the runner's policy.
 */
export function categoriseAfk(afk: boolean | undefined): Category {
	if (afk === true) {
		return 'runner-eligible';
	}
	if (afk === false) {
		return 'human-only';
	}
	return 'if-allowed';
}

/** A scanned item, classified for the dashboard. */
export interface CategorisedItem {
	item: ScannedItem;
	category: Category;
	/** Whether its `blocked_by` deps are all satisfied (ready to be picked up). */
	ready: boolean;
}

/** The items of one repo, bucketed by category and sorted ready-first. */
export type CategorisedGroups = Record<Category, CategorisedItem[]>;

function emptyGroups(): CategorisedGroups {
	return {
		'runner-eligible': [],
		'if-allowed': [],
		'human-only': [],
	};
}

/**
 * Classify a single scanned item: its category (from the gate) and whether its
 * deps are satisfied. Readiness is gate-independent — a `human-only` item can be
 * "ready" too (deps satisfied), it just won't be auto-claimed.
 */
export function categoriseItem(item: ScannedItem): CategorisedItem {
	return {
		item,
		category: categoriseAfk(item.afk),
		ready: item.eligibility.blockedBy.satisfied,
	};
}

/**
 * Bucket a repo's scanned items into the three groups. Within each group, ready
 * (deps-satisfied) items sort above blocked ones; ties keep the incoming order
 * (the scan core already sorts items by slug), so the result is deterministic.
 */
export function categoriseItems(items: ScannedItem[]): CategorisedGroups {
	const groups = emptyGroups();
	for (const item of items) {
		const categorised = categoriseItem(item);
		groups[categorised.category].push(categorised);
	}
	for (const category of CATEGORY_ORDER) {
		groups[category] = sortReadyFirst(groups[category]);
	}
	return groups;
}

/** Stable sort placing ready items before blocked ones, preserving order otherwise. */
export function sortReadyFirst(items: CategorisedItem[]): CategorisedItem[] {
	return items
		.map((value, index) => ({value, index}))
		.sort((a, b) => {
			if (a.value.ready !== b.value.ready) {
				return a.value.ready ? -1 : 1;
			}
			return a.index - b.index;
		})
		.map((entry) => entry.value);
}

/** Per-category and readiness tallies for the dashboard summary. */
export interface CategorySummary {
	runnerEligible: number;
	ifAllowed: number;
	humanOnly: number;
	ready: number;
	blocked: number;
}

/** Aggregate counts across every repo's groups for the summary line. */
export function summariseGroups(
	allGroups: CategorisedGroups[],
): CategorySummary {
	const summary: CategorySummary = {
		runnerEligible: 0,
		ifAllowed: 0,
		humanOnly: 0,
		ready: 0,
		blocked: 0,
	};
	for (const groups of allGroups) {
		summary.runnerEligible += groups['runner-eligible'].length;
		summary.ifAllowed += groups['if-allowed'].length;
		summary.humanOnly += groups['human-only'].length;
		for (const category of CATEGORY_ORDER) {
			for (const entry of groups[category]) {
				if (entry.ready) {
					summary.ready++;
				} else {
					summary.blocked++;
				}
			}
		}
	}
	return summary;
}
