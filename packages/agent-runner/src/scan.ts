import type {Config} from './config.js';
import {detectRepos} from './detect.js';
import {resolveEligibility, type EligibilityResult} from './eligibility.js';
import {ledgerRead, type LedgerBacklogItem} from './ledger-read.js';
import {resolveRepoConfig} from './repo-config.js';

/**
 * A backlog item with its parsed gate/deps, before eligibility resolution. This
 * IS the read seam's resolved backlog shape ({@link LedgerBacklogItem}) — scan
 * keeps the historical name as its public type.
 */
export type BacklogItem = LedgerBacklogItem;

/** A backlog item plus its resolved eligibility verdict. */
export interface ScannedItem extends BacklogItem {
	eligibility: EligibilityResult;
}

/** All scanned backlog items for one participating repo. */
export interface RepoReport {
	path: string;
	items: ScannedItem[];
}

/** The full cross-repo scan result. */
export interface ScanReport {
	repos: RepoReport[];
	totalItems: number;
	totalEligible: number;
}

/**
 * Collect the set of slugs present in a repo's `work/done/`. Used to resolve
 * `blockedBy` (per-repo only). Falls back to the filename when an item has no
 * `slug` frontmatter. Resolves THROUGH the read seam's local-tree method
 * ({@link ledgerRead}) — the single insertion point for the `work/` state read.
 */
export function readDoneSlugs(repoPath: string): Set<string> {
	return ledgerRead.resolveLocalState({repoPath}).doneSlugs;
}

/**
 * Read and parse every `work/backlog/*.md` for a repo, sorted by slug. Resolves
 * THROUGH the read seam's local-tree method ({@link ledgerRead}).
 */
export function readBacklogItems(repoPath: string): BacklogItem[] {
	return ledgerRead.resolveLocalState({repoPath}).backlog;
}

/**
 * Read-only end-to-end scan: detect participating repos, parse their backlog
 * frontmatter, and resolve eligibility per item (autonomy gate + per-repo
 * `blockedBy`). Claims and runs nothing.
 *
 * The autonomy gate's `allowAgents` policy is resolved PER REPO (flag > per-repo
 * `.agent-runner.json` > global > default), exactly like `integration` — so a
 * permissive repo and a strict repo can coexist in one scan.
 */
export function scan(config: Config): ScanReport {
	const repoPaths = detectRepos({
		roots: config.roots,
		include: config.include,
		exclude: config.exclude,
	});

	const repos: RepoReport[] = [];
	let totalItems = 0;
	let totalEligible = 0;

	for (const path of repoPaths) {
		// ONE local-tree resolve per repo through the read seam (offline): backlog +
		// done slugs come from the same resolved `work/` state.
		const {backlog, doneSlugs} = ledgerRead.resolveLocalState({
			repoPath: path,
		});
		const allowAgents = resolveRepoConfig({repoPath: path, global: config})
			.config.allowAgents;
		const items: ScannedItem[] = backlog.map((item) => {
			const eligibility = resolveEligibility({
				humanOnly: item.humanOnly,
				needsAnswers: item.needsAnswers,
				blockedBy: item.blockedBy,
				doneSlugs,
				allowAgents,
			});
			totalItems++;
			if (eligibility.eligible) {
				totalEligible++;
			}
			return {...item, eligibility};
		});
		repos.push({path, items});
	}

	return {repos, totalItems, totalEligible};
}
