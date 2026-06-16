import type {Config} from './config.js';
import {resolveEligibility, type EligibilityResult} from './eligibility.js';
import {
	ledgerRead,
	type LedgerBacklogItem,
	type LedgerPrdPool,
	type LocalLedgerState,
} from './ledger-read.js';
import {listMirrors} from './registry.js';
import {
	fetchMirrorMainOrWarn,
	resolveRepoConfigFromMirror,
} from './repo-mirror.js';
import {resolveRepoConfig} from './repo-config.js';
import {sliceablePrds} from './select-priority.js';
import {
	lintLocalLedger,
	lintRefLedger,
	type DuplicateSlug,
} from './ledger-lint.js';

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

/**
 * A PRD entry in `scan --json`'s sliceable-PRD pool — the SAME shape an eligible
 * slice carries in `items[]` (a `slug` + an `eligibility.eligible` boolean), so
 * the propose-matrix `jq` filter mirrors the slice one: `select(.eligibility.eligible)
 * | "prd:" + .slug`. "Eligible" here means SLICEABLE — the per-repo `autoSlice`
 * gate + the `humanOnly`/`needsAnswers`/`sliceAfter` predicates of `sliceablePrds`
 * (`autoslice-gate`'s pure predicate). Sits under {@link RepoReport.prds} (and
 * the cwd section's `repo.prds`), DISTINCT from the slice-only `items[]` because
 * slices and PRDs are different verbs and project to different `slice:`/`prd:`
 * prefixes — a discriminator on `items[]` would pollute the surface other readers
 * already consume.
 */
export interface ScannedPrd {
	slug: string;
	eligibility: {eligible: boolean};
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
	/**
	 * The SLICEABLE-PRD pool for this repo (the `prds[]` companion of `items[]`):
	 * every PRD in `work/prd/` not already in `work/prd-sliced/`, each tagged with
	 * `eligibility.eligible` from {@link sliceablePrds} (the SAME `autoslice-gate`
	 * predicate the mirror-side pool scan uses — NOT a forked predicate). This is
	 * what makes the propose-mode CI matrix enumerate `prd:<slug>` legs for ready
	 * ungated PRDs alongside `slice:<slug>` legs for eligible slices (the
	 * `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` slice): the
	 * propose `enumerate` `jq` unions both pools and emits one matrix leg per item.
	 * The `autoSlice` gate still BINDS — a repo with `autoSlice` off yields an
	 * all-`eligible:false` pool (so no `prd:` legs).
	 */
	prds: ScannedPrd[];
	/**
	 * The one-slug-one-folder LINT result (PRD `ledger-integrity` story 3): any
	 * slug present in MORE THAN ONE `work/` status folder in THIS repo's ledger.
	 * Empty ⇒ a clean ledger. Non-empty ⇒ a corrupt ledger the formatter WARNS
	 * about loudly and a human must resolve (never auto-fixed). Derived by listing
	 * folder residence, not from any index.
	 */
	ledgerDuplicates: DuplicateSlug[];
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
 * the repo's `autoBuild` policy. The shared core of BOTH the registry scan
 * (mirror-ref state) and the working-tree scan (`run`/in-place) — neither learns
 * how the `work/` state was read; they just hand it here. Exported so the
 * MIRROR-SIDE pool scan (`mirror-pool-scan.ts`) scores the bare-mirror slice pool
 * through the EXACT same eligibility path as in-place (`do-autopick`), not a fork.
 */
/**
 * Score a PRD pool down to its SLICEABLE subset, then label every PRD with
 * `eligibility.eligible` (true ⇔ sliceable). REUSES {@link sliceablePrds} —
 * the SAME `autoslice-gate` predicate the mirror-side `scanMirrorPool` + the
 * in-place `do-autopick` pool already run — so what is sliceable does not
 * fork between the autopick paths and the propose-matrix `scan --json` pool.
 * The `autoSlice` gate BINDS through that predicate; a config-less repo with
 * `autoSlice` off yields an all-`eligible:false` pool (no `prd:` legs).
 */
export function scorePrds(
	repoPath: string,
	pool: LedgerPrdPool,
	autoSlice: boolean,
): ScannedPrd[] {
	const sliceable = new Set(
		sliceablePrds({
			candidates: pool.prds.map((p) => ({
				repoPath,
				slug: p.slug,
				humanOnly: p.humanOnly,
				needsAnswers: p.needsAnswers,
				sliceAfter: p.sliceAfter,
			})),
			slicedSlugs: pool.slicedSlugs,
			autoSlice,
		}).map((p) => p.slug),
	);
	return pool.prds.map((p) => ({
		slug: p.slug,
		eligibility: {eligible: sliceable.has(p.slug)},
	}));
}

export function scoreItems(
	state: Pick<LocalLedgerState, 'backlog' | 'doneSlugs'>,
	autoBuild: boolean,
	counts: {totalItems: number; totalEligible: number},
): ScannedItem[] {
	return state.backlog.map((item) => {
		const eligibility = resolveEligibility({
			humanOnly: item.humanOnly,
			needsAnswers: item.needsAnswers,
			blockedBy: item.blockedBy,
			doneSlugs: state.doneSlugs,
			autoBuild,
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
 * The autonomy gate's `autoBuild` policy is resolved PER REPO. NOTE: a bare
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
		const autoBuild = resolveRepoConfig({
			repoPath: mirror.path,
			global: config,
		}).config.autoBuild;
		// PRD pool — the SLICEABLE-PRD companion of the slice pool above
		// (`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`). Resolve
		// `autoSlice` PER REPO from the mirror's COMMITTED `.agent-runner.json`
		// (exactly as the mirror-side pool scan does — NOT forked); a read fault is
		// non-fatal (warn + global fall-back), since `scan` is read-only and must
		// degrade gracefully (ADR §5/§6).
		let repoAutoSlice = config.autoSlice;
		try {
			repoAutoSlice = resolveRepoConfigFromMirror({
				mirrorPath: mirror.path,
				global: config,
				env: options.env,
			}).autoSlice;
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			options.warn?.(
				`could not read the target repo's config from ${mirror.path}/main; ` +
					`resolving autoSlice from global + default. ${reason}`,
			);
		}
		const prdPool = await ledgerRead.resolveMirrorPrdPool({
			mirrorPath: mirror.path,
			env: options.env,
		});
		const prds = scorePrds(mirror.path, prdPool, repoAutoSlice);
		// The one-slug-one-folder LINT (PRD story 3): derive any slug residing in >1
		// status folder from the mirror's committed `main` tree (the SAME `ls-tree`
		// read the seam uses), so a corrupt ledger is surfaced LOUDLY by the formatter.
		const ledgerDuplicates = lintRefLedger('main', mirror.path, options.env);
		repos.push({
			path: mirror.path,
			items: scoreItems(state, autoBuild, counts),
			prds,
			ledgerDuplicates,
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
 * per-repo `.agent-runner.json` `autoBuild`. The registry `scan` above is the
 * mirror-ref counterpart; this is its working-tree sibling.
 */
export function scanRepoPaths(repoPaths: string[], config: Config): ScanReport {
	const repos: RepoReport[] = [];
	const counts = {totalItems: 0, totalEligible: 0};

	for (const path of repoPaths) {
		const state = ledgerRead.resolveLocalState({repoPath: path});
		const resolved = resolveRepoConfig({repoPath: path, global: config}).config;
		// PRD pool — the SLICEABLE-PRD companion of the slice pool. Resolve
		// `autoSlice` PER REPO from the working-tree `.agent-runner.json` (the same
		// way `autoBuild` is resolved); `sliceablePrds` (the SAME `autoslice-gate`
		// predicate the autopick paths run) decides what is sliceable — no forked
		// predicate. This is what makes the propose-mode CI matrix enumerate `prd:`
		// legs (see `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`).
		const prdPool = ledgerRead.resolvePrdPool({repoPath: path});
		const prds = scorePrds(path, prdPool, resolved.autoSlice);
		// The one-slug-one-folder LINT over THIS working tree's `work/` ledger.
		const ledgerDuplicates = lintLocalLedger(path);
		repos.push({
			path,
			items: scoreItems(state, resolved.autoBuild, counts),
			prds,
			ledgerDuplicates,
		});
	}

	return {
		repos,
		totalItems: counts.totalItems,
		totalEligible: counts.totalEligible,
	};
}
