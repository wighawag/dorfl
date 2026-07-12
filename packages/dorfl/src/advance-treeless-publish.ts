import {runAsync} from './git.js';

/**
 * The SHARED tree-less-result PUBLISH (task
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
 *   - loop: a single mirror's SERIAL batch routinely MIXES rungs — a `build`/`task`
 *     rung integrates `work/<slug>` to the mirror's `main` MID-TICK (via the
 *     job-worktree `doDriver`), and a LATER tree-less rung in the SAME batch holds a
 *     `treelessCwd` cloned BEFORE that integration. So its `HEAD:main` push is
 *     non-fast-forward BY CONSTRUCTION (not a rare concurrent race) — the retry MUST
 *     re-fetch the advanced `main` and rebase the one slug-only tree-less commit onto
 *     it before pushing. The tree-less commit touches only the slug's sidecar/marker,
 *     so the rebase applies cleanly.
 *
 * **C2 rebase-until-real-conflict (task `c2-rebase-until-real-on-durable-main-
 * promotions`).** This same `HEAD:main` push carries the won't-proceed terminal
 * `tasks/ready → tasks/cancelled` / `specs/ready → specs/dropped` (slug-RELOCATION
 * family) when `apply-persist.ts` resolves a `dropped` disposition; under sustained
 * parallel load on the shared `main` ref two DIFFERENT items' concurrent promotions
 * can falsely-contend even though nothing tree-conflicts, exhausting a small fixed
 * cap. C2 turns the existing bounded retry into rebase-until-real-conflict: the
 * GENUINE conflict terminator is REUSED — a rebase replay that fails (the slug is
 * gone from its expected source folder on the new `main`, e.g. a concurrent
 * legitimate same-item transition already moved it) STOPS the loop with the
 * existing definitive outcome (the `rebase --abort` + note path below). A CLEAN
 * re-rebase no longer counts against a tiny budget; `retries` is now a LARGE
 * LIVENESS CEILING on the pathological livelock tail. Modest jitter on the refetch
 * desynchronises the herd. SCOPE caveat (the SCOPE box in the design trail): a
 * relocation MUST keep its source-folder precondition recheck — the rebase replay
 * IS that recheck (the `git mv` fails when the source path is missing on new
 * `main`), so the genuine-conflict signal is preserved verbatim.
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
	/**
	 * LIVENESS CEILING for the re-fetch+rebase retry on a non-fast-forward push.
	 * Under C2 (task `c2-rebase-until-real-on-durable-main-promotions`) this is no
	 * longer a small false-contention budget: a CLEAN re-rebase loops without
	 * counting against a tiny cap; a GENUINE conflict (the rebase fails because the
	 * slug's source path is gone on the new `main` — a concurrent legitimate
	 * same-item transition already moved it) STOPS definitively. The ceiling bounds
	 * only the pathological livelock tail; pass a small value (e.g. `0`) in tests
	 * to exercise the un-retried / cap-exhausted path deterministically.
	 */
	retries: number;
	/**
	 * Modest jitter (ms) on the refetch between retries — load-bearing under
	 * sustained parallel load to desynchronise a thundering-herd lockstep loop (C2,
	 * task `c2-rebase-until-real-on-durable-main-promotions`). Each non-final
	 * attempt sleeps a uniformly-random integer in `[0, jitterMs]` ms. Defaults to
	 * {@link DEFAULT_TREELESS_JITTER_MS}; pass `0` in tests for deterministic,
	 * latency-free retries.
	 */
	jitterMs?: number;
	/** Environment for child git processes. */
	env: NodeJS.ProcessEnv | undefined;
	/** Sink for the non-fatal "could not publish" note. */
	note: (m: string) => void;
}

/**
 * Default modest jitter (ms) on the refetch between {@link pushTreelessResult}
 * retries — see the `PushTreelessResultParams.jitterMs` doc + the C2 block at the
 * top of this file. Mirrors `integration-core.ts`'s `DEFAULT_MERGE_JITTER_MS`.
 */
export const DEFAULT_TREELESS_JITTER_MS = 25;

/**
 * Stderr signatures of a PERMANENT push rejection that NO re-fetch+rebase can
 * ever cure, so the retry loop MUST stop at once instead of burning the whole
 * liveness ceiling ({@link PushTreelessResultParams.retries}, `1000` in prod) on
 * identical round-trips.
 *
 * The tree-less rungs publish by a DIRECT `git push HEAD:main` of a freshly-made
 * commit (see the module header). If the arbiter's `main` hard-requires a status
 * check on EVERY push (GitHub classic branch protection with a non-empty
 * `required_status_checks.contexts`, or a `pre-receive`/ruleset hook), that fresh
 * commit is rejected with `GH006 ... Required status check "..." is expected` /
 * `protected branch hook declined` / `pre-receive hook declined`. A rebase onto
 * the newest `main` does NOT change the fact that the pushed commit has no green
 * check, so retrying is pointless: the push is rejected identically every time.
 *
 * This is DISTINCT from a fast-forward RACE (`non-fast-forward` / `fetch first` /
 * `stale info`), which a rebase DOES cure — and it must win OVER the broad
 * `rejected` contention alternation, because a protected-branch rejection
 * literally contains the word `rejected` (`! [remote rejected] HEAD -> main
 * (protected branch hook declined)`) and would otherwise be mis-read as a race
 * and retried uselessly. See the observation trail for the live incident.
 */
export const PERMANENT_PUSH_REJECTION =
	/GH006|protected branch|hook declined|required status check|cannot force-update the branch/i;

function sleepMs(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
	const jitterMs = params.jitterMs ?? DEFAULT_TREELESS_JITTER_MS;
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
		// A PERMANENT rejection (branch protection / required status check / a
		// pre-receive or ruleset hook) can NEVER be cured by a rebase+re-push — the
		// fresh commit still carries no green check — so stop AT ONCE with an honest,
		// distinct note instead of exhausting the liveness ceiling on identical
		// round-trips. This MUST be checked before `contended`, because a protected-
		// branch rejection contains the word `rejected` and would otherwise be
		// mistaken for a fast-forward race and retried uselessly (see the incident
		// observation).
		if (PERMANENT_PUSH_REJECTION.test(push.stderr)) {
			note(
				`advance: the arbiter's \`main\` rejected the direct tree-less push ` +
					`(${push.stderr.trim() || 'protected branch'}); a re-fetch+rebase cannot ` +
					`cure a required-status-check / protected-branch rule on a direct push, so ` +
					`the work is saved in the working clone for the next pass / a human. ` +
					`Reconcile \`main\`'s protection so direct tree-less ledger writes are ` +
					`allowed (the required check belongs in a ruleset with ` +
					`\`do_not_enforce_on_create\`, not the classic on-every-push gate).`,
			);
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
		// Modest jitter on the refetch (C2, task `c2-rebase-until-real-on-durable-main-
		// promotions`): an instant lockstep refetch→re-push loop maximises mutual
		// rejection under sustained parallel load (thundering herd). A uniformly-
		// random `[0, jitterMs]` ms sleep desynchronises the herd; `jitterMs: 0` opts
		// out (the test seam).
		if (jitterMs > 0) {
			await sleepMs(Math.floor(Math.random() * (jitterMs + 1)));
		}
		// `main` advanced under us — re-fetch + rebase our (one) commit onto it, retry.
		// A CLEAN rebase loops; a GENUINE conflict (the slug's source path is gone on
		// the new `main` because a concurrent legitimate same-item transition already
		// moved it — the slug-relocation source-folder precondition recheck) STOPS
		// definitively below. The natural rebase-conflict IS the C2 terminator (we add
		// no new conflict-detection path; the SCOPE box requires reusing the existing
		// recheck).
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
 * arbiter. The build/task rungs are NOT here — they already push via the
 * job-worktree `doDriver` → `performIntegration` band. The `advancing` borrow +
 * the promote-CAS are NOT here either — they CAS straight to the arbiter, so
 * publishing here would double-publish nothing they own.
 */
export const TREELESS_RUNGS: ReadonlySet<string> = new Set([
	'surface',
	'apply',
	'triage-observation',
]);
