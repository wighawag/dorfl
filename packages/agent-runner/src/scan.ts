import type {Config} from './config.js';
import {resolveEligibility, type EligibilityResult} from './eligibility.js';
import {
	ledgerRead,
	type LedgerBacklogItem,
	type LocalLedgerState,
} from './ledger-read.js';
import {listMirrors} from './registry.js';
import {fetchMirrorMainOrWarn} from './repo-mirror.js';
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
	/**
	 * The repo identity for this row. In the registry model (`scan`) it is the
	 * hub-mirror PATH; for the working-tree scan (`run`, in-place) it is the
	 * working checkout path.
	 */
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
 * Resolve a per-repo `ScannedItem[]` from an already-resolved `work/` state +
 * the repo's `allowAgents` policy. The shared core of BOTH the registry scan
 * (mirror-ref state) and the working-tree scan (`run`/in-place) — neither learns
 * how the `work/` state was read; they just hand it here.
 */
function scoreItems(
	state: Pick<LocalLedgerState, 'backlog' | 'doneSlugs'>,
	allowAgents: boolean,
	counts: {totalItems: number; totalEligible: number},
): ScannedItem[] {
	return state.backlog.map((item) => {
		const eligibility = resolveEligibility({
			humanOnly: item.humanOnly,
			needsAnswers: item.needsAnswers,
			blockedBy: item.blockedBy,
			doneSlugs: state.doneSlugs,
			allowAgents,
		});
		counts.totalItems++;
		if (eligibility.eligible) {
			counts.totalEligible++;
		}
		return {...item, eligibility};
	});
}

/**
 * Read-only end-to-end scan over the REGISTRY (ADR §1): enumerate the registered
 * hub mirrors under `<workspacesDir>/repos/`, **fetch each mirror's `main` first**
 * (ADR §5/§6 — the remote is the source of truth in the registry model), then read
 * each one's full `work/` lifecycle from its BARE `main` ref through the read
 * seam's mirror method (mirrors have no working tree — `resolveLocalState`'s
 * `readdirSync` cannot read them), and resolve eligibility per item (autonomy
 * gate + per-repo `blockedBy`). Claims and runs nothing.
 *
 * **Fetch-first, never fatal:** the old "scan is always offline" invariant is
 * RETIRED (it was the roots-local model); `scan` now refreshes each mirror's
 * `main` before reading. A failed fetch (offline, dead arbiter) is NOT an error —
 * it WARNS via `warn` and falls back to that mirror's last-known `main`, so the
 * queue still reports (its freshness = the last successful fetch). This does NOT
 * change the ledger read STRATEGY (`claim-ledger-vs-protected-main.md`): the
 * offline read of `<mirror>/main:work/...` stays the single strategy — `scan`
 * merely ensures that ref is fresh before reading it.
 *
 * Discovery is the registered hub-mirror set, NOT a config `roots` walk (there is
 * no `roots`/`remotes` field). `scan`/`status` share the {@link listMirrors}
 * primitive; the per-repo `work/` read goes through the seam's mirror-ref method.
 *
 * The autonomy gate's `allowAgents` policy is resolved PER REPO. NOTE: a bare
 * mirror has no checked-out `.agent-runner.json`, so the per-repo file cannot be
 * read from it — the global/env-resolved policy applies (the per-repo override is
 * a working-checkout concern, served by {@link scanRepoPaths}).
 */
export async function scan(
	config: Config,
	options: {warn?: (message: string) => void; env?: NodeJS.ProcessEnv} = {},
): Promise<ScanReport> {
	const mirrors = listMirrors({
		workspacesDir: config.workspacesDir,
		env: options.env,
	});

	const repos: RepoReport[] = [];
	const counts = {totalItems: 0, totalEligible: 0};

	for (const mirror of mirrors) {
		// Fetch-first (ADR §5/§6): refresh this mirror's `main` so the read below
		// sees the remote truth. Never fatal — a failed fetch WARNS and falls back to
		// the mirror's last-known `main` (the read strategy is unchanged).
		fetchMirrorMainOrWarn({
			mirrorPath: mirror.path,
			warn: options.warn,
			env: options.env,
		});
		// Read the full `work/` lifecycle from the mirror's bare `main` ref through
		// the read seam (git ls-tree/show; NOT a working-tree read).
		const state = await ledgerRead.resolveMirrorState({
			mirrorPath: mirror.path,
			env: options.env,
		});
		const allowAgents = resolveRepoConfig({
			repoPath: mirror.path,
			global: config,
		}).config.allowAgents;
		repos.push({
			path: mirror.path,
			items: scoreItems(state, allowAgents, counts),
		});
	}

	return {
		repos,
		totalItems: counts.totalItems,
		totalEligible: counts.totalEligible,
	};
}

/**
 * Read-only scan over an EXPLICIT set of working checkouts, used by the in-place
 * worker paths (`run`) that operate on a real checkout rather than the registry's
 * bare mirrors. This is a working-TREE read (it has nothing to fetch — the
 * checkout IS the local state); the fetch-first contract (ADR §5/§6) applies to
 * the REGISTRY `scan` above, which refreshes each bare mirror before reading.
 * Reads each repo's `work/` via the read seam's local-tree method and honours its
 * per-repo `.agent-runner.json` `allowAgents`. The registry `scan` above is the
 * mirror-ref counterpart; this is its working-tree sibling.
 */
export function scanRepoPaths(repoPaths: string[], config: Config): ScanReport {
	const repos: RepoReport[] = [];
	const counts = {totalItems: 0, totalEligible: 0};

	for (const path of repoPaths) {
		const state = ledgerRead.resolveLocalState({repoPath: path});
		const allowAgents = resolveRepoConfig({repoPath: path, global: config})
			.config.allowAgents;
		repos.push({path, items: scoreItems(state, allowAgents, counts)});
	}

	return {
		repos,
		totalItems: counts.totalItems,
		totalEligible: counts.totalEligible,
	};
}
