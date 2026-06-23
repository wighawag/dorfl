import type {Config} from './config.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {resolveRepoConfigFromMirror} from './repo-mirror.js';
import {
	scoreItems,
	scoreBriefs,
	toScannedLifecycle,
	type ScannedItem,
	type ScanReport,
	type RepoReport,
} from './scan.js';
import {
	taskableBriefs,
	type BriefCandidate,
	type SelectedLifecyclePools,
} from './select-priority.js';
import {gatherLifecycleMirror} from './lifecycle-gather.js';
import type {LifecyclePoolGates} from './lifecycle-pools.js';
import {heldTaskSlugs} from './item-lock.js';

/**
 * The MIRROR-SIDE eligible-pool scan — the isolated counterpart to
 * `do-autopick`'s in-place pool scan ({@link performDoAuto}). It enumerates the
 * SAME two pools (eligible TASKS + taskable BRIEFS) but reads a BARE hub mirror's
 * committed `main` ref (`git ls-tree`/`git show`), NOT a working checkout.
 *
 * This is the ONE reusable enumeration unit the brief's FOLD-IN note demands: BOTH
 * the `run` loop driver's isolated+parallel auto-pick AND the one-shot/CI
 * `advance --remote -n` / the CI matrix consume it, so the `-n`/auto-pick rungs
 * (both `do` and `advance`, both `run`-loop and one-shot) all call the SAME scan.
 * A standalone `do --remote -n` then falls out as a thin caller — the scan is NOT
 * invented twice (the existing inline `-n`×`--remote` REFUSAL in `cli.ts` is the
 * placeholder this scan replaces; removing the refusal is the driver/caller's job).
 *
 * It only ENUMERATES the pool — it never claims, builds, or runs anything. `-n`
 * stays ALWAYS SEQUENTIAL (US #25): the selection layer ({@link selectPrioritised})
 * orders + counts; parallelism comes only from `run`'s concurrent loop or the CI
 * matrix, never from this scan or from `-n`.
 *
 * It is the MIRROR-ref counterpart of `do-autopick`'s in-place scan, reusing the
 * exact predicates rather than re-deriving them:
 *
 *   - **tasks** — {@link scoreItems} (the SAME eligibility scoring the in-place
 *     `scanRepoPaths`/registry `scan` use) over the mirror's `work/backlog` +
 *     `work/done` read via {@link LedgerReadStrategy.resolveMirrorState}.
 *   - **taskable briefs** — {@link taskableBriefs} (`autoslice-gate`'s predicate)
 *     over the mirror's `work/briefs/ready` + `work/briefs/tasked` read via the mirror-ref
 *     {@link LedgerReadStrategy.resolveMirrorBriefPool}.
 *
 * Per-repo policy parity: a bare mirror has no checked-out `.agent-runner.json`,
 * but the COMMITTED one is reachable on `main` (the `do --remote` per-repo seam).
 * We layer it via {@link resolveRepoConfigFromMirror} so the same logical `work/`
 * state yields the SAME `autoBuild`/`autoTask` decision an in-place checkout
 * would — that is what makes the mirror scan PARITY-equal to the in-place one.
 */

/** What {@link scanMirrorPool} needs: which bare mirror + the global config. */
export interface ScanMirrorPoolOptions {
	/** The bare hub mirror directory (`<workspacesDir>/repos/<key>.git`). */
	mirrorPath: string;
	/**
	 * The global + default config layer. The repo's COMMITTED `.agent-runner.json`
	 * (read from the mirror's `main`) is layered on top, so `autoBuild`/`autoTask`
	 * resolve per-repo exactly as the in-place scan resolves them from the checkout.
	 */
	config: Config;
	/**
	 * The mirror-LOCAL ref whose `work/` tree to read (default `main`). A bare hub
	 * mirror's `main` is a LOCAL branch — never `origin/main`.
	 */
	ref?: string;
	/**
	 * Override the read seam (tests inject a stub). Defaults to the active
	 * {@link ledgerRead} — the SAME seam the in-place scan reads through.
	 */
	read?: LedgerReadStrategy;
	/**
	 * Sink for a non-fatal per-repo-config read warning. The scan must never error
	 * out on a config-read fault — it falls back to global + default (the
	 * no-per-repo behaviour) and warns. (Fetch-first freshness is the CALLER's job,
	 * exactly as it is for the registry `scan`; this reads the already-fetched ref.)
	 */
	warn?: (message: string) => void;
	env?: NodeJS.ProcessEnv;
	/**
	 * The LIFECYCLE-POOL create-gates (task `advance-autopick-lifecycle-pools`),
	 * the internal hook the gate tasks will wire to `observationTriage` /
	 * `surfaceBlockers`. INTERIM, born OFF: omitted ⇒ BOTH create-gates OFF, so the
	 * mirror-side triage + surface sub-pools contribute NOTHING (the apply sub-pool
	 * is always-on). The mirror enumeration mirrors the in-place one exactly.
	 */
	lifecycleGates?: LifecyclePoolGates;
	/**
	 * The per-machine config-override map (ADR
	 * `per-machine-config-override-layer`), threaded into the mirror-side per-repo
	 * resolution so the override applies to the autopick pool scan. Default: empty.
	 */
	override?: import('./config-override.js').ConfigOverrideMap;
}

/**
 * The enumerated mirror-side pool — the isolated counterpart of `do-autopick`'s
 * two pools. Both drivers feed `report` + `briefs` into the SAME
 * {@link selectPrioritised} (the loop driver takes all; the one-shot/CI driver
 * bounds by a SEQUENTIAL `count`).
 */
export interface MirrorPoolScanResult {
	/**
	 * The task pool as a one-repo {@link ScanReport} (the mirror is the single
	 * repo), scored through {@link scoreItems} — the SAME shape
	 * {@link selectPrioritised} consumes for the in-place scan, so the task
	 * selection is byte-identical to `run`'s.
	 */
	report: ScanReport;
	/** Every scanned task (eligible or not), in scan order. */
	tasks: ScannedItem[];
	/** Just the eligible subset of {@link tasks} (convenience for assertions/callers). */
	eligibleTasks: ScannedItem[];
	/**
	 * The TASKABLE BRIEF pool — already filtered through `taskableBriefs`
	 * (`autoslice-gate`'s predicate). In declaration order; the selection layer
	 * does not re-gate it.
	 */
	briefs: BriefCandidate[];
	/**
	 * The LIFECYCLE pools (task `advance-autopick-lifecycle-pools`): untriaged
	 * observations (triage), `needsAnswers`-blocked items with no all-answered
	 * sidecar (surface), and answered-sidecar items (apply). Built through the SAME
	 * shared {@link buildLifecyclePools} unit the in-place caller uses (NOT a second
	 * enumeration), so the in-place + mirror-side selections AGREE. The create-gates
	 * default OFF (interim); apply is always present. The drivers feed this straight
	 * into {@link selectPrioritised}'s `lifecycle` slot.
	 */
	lifecycle: SelectedLifecyclePools;
}

/**
 * Run the mirror-side eligible-pool scan over a single bare hub mirror. Reads
 * both pools from its committed `main`, scores/filters them through the EXACT
 * in-place predicates, and returns the shape both drivers consume.
 */
export async function scanMirrorPool(
	options: ScanMirrorPoolOptions,
): Promise<MirrorPoolScanResult> {
	const {mirrorPath, config, ref = 'main', env} = options;
	const read = options.read ?? ledgerRead;
	const warn = options.warn;

	// Per-repo policy parity: layer the COMMITTED `.agent-runner.json` from the
	// mirror's `main` (the `do --remote` per-repo seam) onto global. Never fatal —
	// a config-less repo or a read fault falls back to global + default.
	let repoConfig: Config;
	try {
		repoConfig = resolveRepoConfigFromMirror({
			mirrorPath,
			global: config,
			env,
			override: options.override,
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		warn?.(
			`could not read the target repo's config from ${mirrorPath}/main; ` +
				`resolving from global + default. ${reason}`,
		);
		repoConfig = config;
	}

	// Pool 1 — eligible TASKS from the bare mirror's `work/backlog`+`work/done`,
	// scored through the EXACT same `scoreItems` the in-place/registry scans use.
	const state = await read.resolveMirrorState({mirrorPath, ref, env});
	const counts = {totalItems: 0, totalEligible: 0};
	// HELD-SLUG SUBTRACTION (brief `ledger-status-per-item-lock-refs` US #15): a bare
	// hub mirror's arbiter is its `origin`; read the held lock refs from there and
	// exclude those slugs from the enumerated `backlog/` pool. Non-fatal (empty set
	// on any fault) and redundant-but-harmless while the body still moves — wired now
	// so task #9 needs no reader change. Freshness (fetch-first) is the CALLER's job
	// for the pool ref, exactly as it is for the config read; `heldTaskSlugs` does
	// its own lock-ref fetch.
	const heldSlugs = await heldTaskSlugs(mirrorPath, 'origin', env);
	const items = scoreItems(state, repoConfig.autoBuild, counts, heldSlugs);
	// Pool 2 — TASKABLE BRIEFS from the bare mirror's `work/briefs/ready`+`work/briefs/tasked`,
	// filtered through `autoslice-gate`'s predicate (NOT reinvented). Read FIRST so
	// we can populate the `briefs[]` companion of `items[]` on the RepoReport below.
	const pool = await read.resolveMirrorBriefPool({mirrorPath, ref, env});
	const briefs = taskableBriefs({
		candidates: pool.briefs.map((p) => ({
			repoPath: mirrorPath,
			slug: p.slug,
			humanOnly: p.humanOnly,
			needsAnswers: p.needsAnswers,
			briefAfter: p.briefAfter,
		})),
		taskedSlugs: pool.taskedSlugs,
		autoTask: repoConfig.autoTask,
	});
	// The one-slug-one-folder LINT is a HUMAN-FACING surface (`scan`/`status`); this
	// mirror-side pool scan exists only to SCORE the task/brief candidate pools for
	// autonomous selection, never to render a dashboard, so it carries an empty lint
	// (the duplicate surface is the user-facing `scan`/`status`, per the task). The
	// `briefs[]` companion of `items[]` is filled via the SAME `scoreBriefs` helper
	// `scan`/`scanRepoPaths` call — so the propose-matrix `jq` (`repos[].briefs[] |
	// select(.eligibility.eligible)`) sees the same shape on every surface.
	// Pools 3 + 4 — the LIFECYCLE pools, gathered from the SAME mirror `main` (the
	// `needsAnswers` backlog/briefs + their sidecars + `work/observations/`) and built
	// through the SHARED enumeration unit the in-place caller uses — so the in-place
	// + mirror-side selections AGREE. Create-gates default OFF (interim); apply
	// (consume) is always present.
	const lifecycle = await gatherLifecycleMirror({
		mirrorPath,
		ref,
		read,
		gates: options.lifecycleGates,
		env,
	});

	const repo: RepoReport = {
		path: mirrorPath,
		items,
		briefs: scoreBriefs(mirrorPath, pool, repoConfig.autoTask),
		// The propose-matrix lifecycle pool on this mirror's `RepoReport` — the SAME
		// `gatherLifecycleMirror` result projected onto the `scan --json` shape, so
		// the dashboard/matrix surface agrees with the selection scoring below.
		lifecycle: toScannedLifecycle(lifecycle),
		ledgerDuplicates: [],
	};
	const report: ScanReport = {
		repos: [repo],
		totalItems: counts.totalItems,
		totalEligible: counts.totalEligible,
	};

	return {
		report,
		tasks: items,
		eligibleTasks: items.filter((i) => i.eligibility.eligible),
		briefs,
		lifecycle,
	};
}
