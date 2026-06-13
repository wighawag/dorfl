import {runAsync} from './git.js';

/**
 * The SHARED tree-less-result PUBLISH (slice
 * `loop-advance-persists-treeless-rungs-to-arbiter`) — the ONE implementation of
 * "ff-push a locally-committed tree-less rung result to the arbiter" called by
 * BOTH advance drivers that run the tick in a working clone:
 *
 *   - the one-shot ISOLATED runner (`advance-isolated.ts`'s
 *     {@link import('./advance-isolated.js')} `performAdvanceIsolated`), and
 *   - the LOOP / registry-set driver (`advance-loop-driver.ts`'s `advanceOnce`),
 *     whose per-mirror `treelessCwd` (cloned once per tick by the CLI) is wiped +
 *     re-cloned every tick, so a locally-committed sidecar would otherwise be lost.
 *
 * The tree-less lifecycle rungs (surface / apply / triage-observation) commit the
 * sidecar / `needsAnswers` / `triaged:` marker LOCALLY in their working clone
 * (`surface-persist.ts`, `apply-persist.ts`); only the `advancing` borrow + the
 * promote-CAS reach the arbiter on their own. The arbiter is the source of truth
 * for the ledger, so a local commit in a per-tick clone is NOT on the ledger until
 * pushed. This is that push — NO new isolation MECHANISM, just a git ff-push of an
 * already-committed `main`.
 *
 * The bounded re-fetch + rebase retry is LOAD-BEARING, not defensive padding:
 *   - one-shot: a sequential `-n` run ff-pushes item 1's surface, then item 2's
 *     clone branches off the advanced `main`;
 *   - loop: a single mirror's SERIAL batch routinely MIXES rungs — a `build`/`slice`
 *     rung integrates `work/<slug>` to the mirror's `main` MID-TICK (via the
 *     job-worktree `doDriver`), and a LATER tree-less rung in the SAME batch holds a
 *     `treelessCwd` cloned BEFORE that integration. So its `HEAD:main` push is
 *     non-fast-forward BY CONSTRUCTION (not a rare concurrent race) — the retry MUST
 *     re-fetch the advanced `main` and rebase the one slug-only tree-less commit onto
 *     it before pushing. The tree-less commit touches only the slug's sidecar/marker,
 *     so the rebase applies cleanly.
 *
 * NEVER `--force`. A push that keeps failing (or a genuine rebase conflict) is
 * REPORTED via `note` but does NOT crash the tick — the work stays committed in the
 * clone for the next pass / a human.
 */
export interface PushTreelessResultParams {
	/** The working clone whose `HEAD:main` carries the tree-less commit to publish. */
	cwd: string;
	/** Name of the arbiter git remote in `cwd` (the ledger to publish to). */
	arbiter: string;
	/** How many re-fetch+rebase retries to make on a non-fast-forward push. */
	retries: number;
	/** Environment for child git processes. */
	env: NodeJS.ProcessEnv | undefined;
	/** Sink for the non-fatal "could not publish" note. */
	note: (m: string) => void;
}

/**
 * Fast-forward-push the working clone's `main` to the arbiter after a tree-less
 * rung committed locally, so the sidecar / marker LANDS on the arbiter. Re-fetches
 * + retries a bounded few times if `main` advanced under us (NEVER `--force`); a
 * push that keeps failing is reported but does not crash the tick (the work is
 * still saved in the clone for the next pass / a human).
 */
export async function pushTreelessResult(
	params: PushTreelessResultParams,
): Promise<void> {
	const {cwd, arbiter, retries, env, note} = params;
	for (let i = 0; i <= retries; i++) {
		const push = await runAsync(
			'git',
			['push', '--quiet', arbiter, 'HEAD:main'],
			cwd,
			{env},
		);
		if (push.status === 0) {
			return;
		}
		const contended = /non-fast-forward|rejected|fetch first|stale info/i.test(
			push.stderr,
		);
		if (!contended || i === retries) {
			note(
				`advance: could not publish the tree-less result to ` +
					`${arbiter}/main (${push.stderr.trim() || 'push failed'}); the work is ` +
					`saved in the working clone and will re-apply on the next pass.`,
			);
			return;
		}
		// `main` advanced under us — re-fetch + rebase our (one) commit onto it, retry.
		await runAsync('git', ['fetch', '--quiet', arbiter], cwd, {env});
		const rebase = await runAsync(
			'git',
			['rebase', '--quiet', `${arbiter}/main`],
			cwd,
			{env},
		);
		if (rebase.status !== 0) {
			await runAsync('git', ['rebase', '--abort'], cwd, {env});
			note(
				`advance: the tree-less result conflicted with ${arbiter}/main; ` +
					`the work is saved in the working clone for the next pass / a human.`,
			);
			return;
		}
	}
}

/**
 * The rung kinds that commit a tree-less result LOCALLY (sidecar / `needsAnswers`
 * / `triaged:` marker) and therefore need {@link pushTreelessResult} to reach the
 * arbiter. The build/slice rungs are NOT here — they already push via the
 * job-worktree `doDriver` → `performIntegration` band. The `advancing` borrow +
 * the promote-CAS are NOT here either — they CAS straight to the arbiter, so
 * publishing here would double-publish nothing they own.
 */
export const TREELESS_RUNGS: ReadonlySet<string> = new Set([
	'surface',
	'apply',
	'triage-observation',
]);
