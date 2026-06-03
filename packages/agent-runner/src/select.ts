import type {ScanReport} from './scan.js';

/** One item the runner intends to claim+run, identified by repo + slug. */
export interface Candidate {
	repoPath: string;
	slug: string;
}

export interface SelectCaps {
	/** Global cap on items claimed+run in one tick. */
	maxParallel: number;
	/** Per-repo cap on concurrent claims. */
	perRepoMax: number;
}

/**
 * Build the ordered list of candidates to attempt from a `scan` report,
 * respecting the concurrency caps. Only eligible items are considered. Selection
 * is round-robin across repos for fairness (so a single busy repo cannot starve
 * the others under `maxParallel`), capping each repo at `perRepoMax` and the
 * total at `maxParallel`. Deterministic: repos and items are already sorted by
 * the scan core.
 *
 * NOTE: this is optimistic selection only — actual ownership is decided by the
 * arbiter when `claim.sh` runs. A candidate that loses the race is dropped then.
 */
export function selectCandidates(
	report: ScanReport,
	caps: SelectCaps,
): Candidate[] {
	// Per-repo queues of eligible slugs, preserving scan order.
	const queues = report.repos.map((repo) => ({
		path: repo.path,
		slugs: repo.items
			.filter((item) => item.eligibility.eligible)
			.map((item) => item.slug),
		taken: 0,
	}));

	const picks: Candidate[] = [];
	let progress = true;
	while (picks.length < caps.maxParallel && progress) {
		progress = false;
		for (const queue of queues) {
			if (picks.length >= caps.maxParallel) {
				break;
			}
			if (queue.taken >= caps.perRepoMax) {
				continue;
			}
			const next = queue.slugs[queue.taken];
			if (next === undefined) {
				continue;
			}
			picks.push({repoPath: queue.path, slug: next});
			queue.taken++;
			progress = true;
		}
	}

	return picks;
}
