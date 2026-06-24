/**
 * Pure categorisation of backlog items into the "who can take it" groups used by
 * the human decision dashboard. Grouping is deliberately INDEPENDENT of the
 * repo's `autoBuild` policy: a human always sees the full picture, and the
 * policy only changes the eligibility *verdict* / summary counts elsewhere —
 * never which group an item lands in.
 */

import type {ScannedItem} from './scan.js';

/**
 * Which group an item belongs to, derived from its two autonomy axes
 * (`humanOnly`, `needsAnswers`) and its dependency readiness (NOT the runner's
 * `autoBuild` policy):
 *   - `agent-claimable` — neither axis gated AND deps satisfied: an agent can
 *     claim it now (provided this repo's `autoBuild` policy is on).
 *   - `human-only` — `humanOnly: true`: a human decides/builds it; an agent never
 *     claims it, regardless of policy or deps.
 *   - `needs-answers` — not `humanOnly` but `needsAnswers: true`: open questions
 *     block autonomous work until they are answered (the questions live in the
 *     body); an agent never claims it.
 *   - `blocked` — neither axis gated but deps unsatisfied: would be
 *     agent-claimable once its blockers reach `work/done/`.
 *
 * `humanOnly` takes precedence over `needsAnswers` for display grouping (a single
 * group per item), but BOTH gate the agent identically in `eligibility`.
 */
export type Category =
	| 'agent-claimable'
	| 'human-only'
	| 'needs-answers'
	| 'blocked';

/** Stable display order for the four groups. */
export const CATEGORY_ORDER: Category[] = [
	'agent-claimable',
	'human-only',
	'needs-answers',
	'blocked',
];

/** Human-facing section headings for each group. */
export const CATEGORY_LABELS: Record<Category, string> = {
	'agent-claimable':
		'Agent-claimable now (not human-only, no open questions, deps satisfied; needs --auto-build)',
	'human-only': 'Human-only (humanOnly: true — a human decides/builds)',
	'needs-answers':
		'Needs answers (needsAnswers: true — open questions block autonomous work)',
	blocked: 'Blocked (not gated, waiting on deps)',
};

/** A scanned item, classified for the dashboard. */
export interface CategorisedItem {
	item: ScannedItem;
	category: Category;
	/** Whether its `blockedBy` deps are all satisfied (ready to be picked up). */
	ready: boolean;
}

/**
 * Map an item's autonomy axes (`humanOnly`, `needsAnswers`) + dependency
 * readiness to its dashboard category. Policy-independent by design: the
 * category reflects what the author declared and whether its deps are met, not
 * the runner's `autoBuild` policy. `humanOnly` is shown before `needsAnswers`
 * when both are set, so the REASON is always visible.
 */
export function categoriseItem(item: ScannedItem): CategorisedItem {
	const ready = item.eligibility.blockedBy.satisfied;
	let category: Category;
	if (item.humanOnly === true) {
		category = 'human-only';
	} else if (item.needsAnswers === true) {
		category = 'needs-answers';
	} else if (ready) {
		category = 'agent-claimable';
	} else {
		category = 'blocked';
	}
	return {item, category, ready};
}

/** The items of one repo, bucketed by category and sorted ready-first. */
export type CategorisedGroups = Record<Category, CategorisedItem[]>;

function emptyGroups(): CategorisedGroups {
	return {
		'agent-claimable': [],
		'human-only': [],
		'needs-answers': [],
		blocked: [],
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
	agentClaimable: number;
	humanOnly: number;
	needsAnswers: number;
	blocked: number;
	ready: number;
}

/** Aggregate counts across every repo's groups for the summary line. */
export function summariseGroups(
	allGroups: CategorisedGroups[],
): CategorySummary {
	const summary: CategorySummary = {
		agentClaimable: 0,
		humanOnly: 0,
		needsAnswers: 0,
		blocked: 0,
		ready: 0,
	};
	for (const groups of allGroups) {
		summary.agentClaimable += groups['agent-claimable'].length;
		summary.humanOnly += groups['human-only'].length;
		summary.needsAnswers += groups['needs-answers'].length;
		summary.blocked += groups['blocked'].length;
		for (const category of CATEGORY_ORDER) {
			for (const entry of groups[category]) {
				if (entry.ready) {
					summary.ready++;
				}
			}
		}
	}
	return summary;
}
