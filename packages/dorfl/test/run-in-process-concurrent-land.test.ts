import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {runOnce, type Dorfl} from '../src/run.js';
import {readItemLock} from '../src/item-lock.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Story 13 (in-process half) of
 * `work/prds/tasked/land-time-reverify-and-parallel-merge-ceiling.md`: two
 * SAME-process merge jobs through ONE `run` instance, wired with the per-repo
 * `createKeyedLock()` / `integrateLock` `run.ts` plugs into `performIntegration`'s
 * rebase-to-integrate TAIL. The COMPANION cross-job (CAS-loop only) half is its
 * own task — this file proves the IN-PROCESS land slot is serialised
 * deterministically by EXTERNAL behaviour ONLY, NEVER by inspecting the lock's
 * internals (no probing `integrateLock` itself, no `claimLock` peeking, no
 * lock-acquire-order asserts) — exactly the three behaviours the task names:
 *
 *   (1) exactly ONE job's tree is the new `<arbiter>/main` TIP after both finish
 *       (the other is in `main`'s HISTORY, never AT tip — proof the land slot
 *       linearised them rather than both pushing the SAME pre-merge base);
 *   (2) the loser EITHER lands a clean re-verified tree OR ends `state: stuck`
 *       with a reason naming a REAL cause (re-verify red, rebase conflict) — it
 *       is NEVER bounced for "lock contention" alone (the in-process lock WAITS,
 *       it does not bounce);
 *   (3) `<arbiter>/main` never contains a tree that fails `verify` — the
 *       freshly-rebased tip re-runs the gate before each push, so every
 *       commit that LANDED was verified on its own would-be-merged tree.
 *
 * Scenario kept minimal per the task's prompt: disjoint files (`<slug>.txt`),
 * `verify: exit 0` (both verify trivially in isolation), MERGE mode, two slugs at
 * `maxParallel: 2` + `perRepoMax: 2` so they genuinely contend in-process for the
 * one same-repo land slot. The bare arbiter + per-test scratch root is the same
 * temp-bare-arbiter harness `run.test.ts` uses (`seedRepoWithArbiter`), which
 * per-test isolates the otherwise-shared `~/.pi/agent/sessions/` via
 * `isolatePiAgentDir` — both per the task-template's shared-location rule.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-run-inproc-land-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const PASS = 'exit 0';

/** Disjoint editor: each slug writes to its OWN `<slug>.txt` (no textual overlap). */
const disjointEditingAgent: Dorfl = ({cwd, slug}) => {
	writeFileSync(join(cwd, `${slug}.txt`), `work done for ${slug}\n`);
	return {ok: true};
};

function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
	return scanRepoPaths([join(scratch.root, 'project')], config);
}

describe('runOnce — in-process concurrent merge land via `integrateLock` (Story 13 in-process half)', () => {
	it('two same-process same-repo merge jobs both LAND with exactly one tree as the new main tip, `verify` is green on the result, and neither loser is bounced for "lock contention" alone', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['pa', 'pb']);
		const config = mergeConfig({
			defaultArbiter: 'arbiter',
			// Two slots in flight, both on the SAME repo — so the only contention
			// they can race on is the SAME-repo land slot (the in-process
			// `integrateLock`'s purpose). The `run.ts` wiring constructs ONE
			// `createKeyedLock()` per `runOnce` call and threads it into both jobs
			// (per-repo key), exactly the configuration this test exercises.
			maxParallel: 2,
			perRepoMax: 2,
			integration: 'merge',
			agentCmd: 'true',
			verify: PASS,
			// The fresh-worktree gate runs `verify` on the REBASED tip — the load-
			// bearing invariant of this brief. Explicit here (it already defaults ON)
			// so the test pins the behaviour, not the default.
			freshWorktreeGate: true,
			autoBuild: true,
		});

		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			dorfl: disjointEditingAgent,
			env: gitEnv(),
		});

		// Both items reached a terminal status (no `runOnce` crash, no item lost
		// to the in-process race-handling); each is either `claimed-done` (clean
		// land — re-verified after rebase) OR `needs-attention`/`tests-failed`
		// (stuck on a REAL cause). The "lock contention" failure mode does NOT
		// exist — the in-process `integrateLock` is a wait, not a bounce.
		expect(result.items).toHaveLength(2);
		for (const item of result.items) {
			expect(['claimed-done', 'needs-attention', 'tests-failed']).toContain(
				item.status,
			);
		}
		// Disjoint files + green `verify` ⇒ neither rebase can conflict and neither
		// re-verify can fail, so the only acceptable terminal state for THIS
		// scenario is BOTH claimed-done (Story 13's "lands a clean re-verified
		// tree" arm of the loser-disjunction). The OTHER arm (stuck with a real
		// cause) is covered by sibling tests; here the disjoint scenario fixes the
		// expectation so a regression to "loser bounced for lock contention" is
		// observable as a status flip. This is a DELIBERATE tightening of the
		// broader allowed-set check above for the disjoint + green scenario
		// specifically — recorded as an explicit design choice in the
		// `## Decisions` block of `work/tasks/done/test-in-process-concurrent-land.md`
		// (see follow-up `harden-test-in-process-concurrent-land-review-nits`).
		expect(result.claimedAndDone).toBe(2);
		expect(result.items.every((i) => i.status === 'claimed-done')).toBe(true);

		// (1) EXACTLY ONE job's tree is the new `<arbiter>/main` TIP. The TIP
		// commit is the SECOND-to-land's done-move (the loser, re-rebased onto the
		// winner's now-advanced main and landed on top); the FIRST-to-land's
		// done-move is in `main`'s history but NOT at tip. We read the subject of
		// each commit on main and look for the slug pattern the done-move stamps:
		// `feat(<slug>):...; done`. If the lock had failed and both jobs had
		// pushed the SAME pre-merge base, only ONE done would appear (the other
		// overwritten) OR `runOnce` would have routed one to needs-attention.
		gitIn(['fetch', '-q', 'arbiter'], seeded.repo);
		const subjects = gitIn(['log', '--format=%s', 'arbiter/main'], seeded.repo)
			.trim()
			.split('\n');
		const doneSubjects = subjects.filter((s) => /; done$/.test(s));
		expect(doneSubjects).toHaveLength(2);
		const tipDoneMatch = doneSubjects[0].match(/^feat\((pa|pb)\):/);
		const histDoneMatch = doneSubjects[1].match(/^feat\((pa|pb)\):/);
		expect(tipDoneMatch).not.toBeNull();
		expect(histDoneMatch).not.toBeNull();
		const tipSlug = tipDoneMatch![1];
		const histSlug = histDoneMatch![1];
		// The two done-moves land at DIFFERENT positions on main: exactly one at
		// the tip, the OTHER strictly earlier in history. This is the external
		// signature of a serialised land (both pushed, but ordered) — the negation
		// of "both pushed the same base and one silently won by timing".
		expect(tipSlug).not.toBe(histSlug);
		expect(new Set([tipSlug, histSlug])).toEqual(new Set(['pa', 'pb']));

		// (2) Neither loser is `stuck` — the in-process lock WAITED, never bounced.
		// (The disjunction's stuck-arm test lives elsewhere; here we pin the no-
		// spurious-bounce property: a same-repo land-slot wait must NEVER show up
		// as `state: stuck` on either item's per-item lock.)
		for (const slug of ['pa', 'pb']) {
			expect(stuckLockOnArbiter(seeded.repo, slug)).toBe(false);
			const lock = await readItemLock({
				item: `task:${slug}`,
				cwd: seeded.repo,
				arbiter: 'arbiter',
				env: gitEnv(),
			});
			// If a per-item lock is still readable post-land it must NOT be
			// `stuck` (Story 13 forbids a stuck route for in-process land-slot
			// contention), and its `reason`, if any, must not name lock-contention
			// as the cause. A `stuck` lock here would mean the loser was bounced
			// for waiting on the in-process `integrateLock` — the exact regression
			// this assertion guards.
			if (lock !== undefined) {
				expect(lock.state).not.toBe('stuck');
				// Belt-and-braces (per follow-up task nit #3): even if the state
				// check somehow drifts, a `reason` naming lock contention would be
				// the fingerprint of the exact regression this test guards. The
				// `reason` field is present iff `state === 'stuck'` (see
				// `item-lock.ts`), so in a passing run this is a vacuous guard;
				// under a regression it turns a status flip into a specific,
				// self-explaining failure.
				if (lock.reason !== undefined) {
					expect(lock.reason).not.toMatch(/lock|contention/i);
				}
			}
		}

		// (3) Both done-bodies are present on `<arbiter>/main`. The disjoint trees
		// composed cleanly, which is only possible if the loser re-rebased onto
		// the winner's tip BEFORE its push (else the loser's push would have
		// dropped the winner's done-body — the very regression the lock prevents).
		expect(existsOnArbiterMain(seeded.repo, 'done', 'pa')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'pb')).toBe(true);

		// (3b) The post-land main tip actually CONTAINS both workers' content
		// markers — the per-item file `<slug>.txt` written by
		// `disjointEditingAgent` with a body unique to that slug. This is the
		// non-trivial "the tree on main is not broken and carries both landed
		// changes" check: if the loser had raced its push against a stale base
		// (the lock's failure mode), or if the merge had dropped one worker's
		// content, one of these `git show` reads would miss the marker. Replaces
		// a former `sh -c 'exit 0'` re-verify against the tip that was trivially
		// green by construction (see follow-up task nit #2). Re-running the
		// configured `verify` itself would be circular — the engine's fresh-
		// worktree gate already ran that against the rebased tip on the LAND
		// path (behaviour (1)/(2) above pin it externally); what this check adds
		// is that the merged TREE composed both workers' disjoint edits.
		const fresh = seeded.clone('verify-check');
		gitIn(['switch', '-q', '-c', 'verify-tip', 'arbiter/main'], fresh);
		for (const slug of ['pa', 'pb']) {
			const marker = gitIn(['show', `arbiter/main:${slug}.txt`], fresh);
			expect(marker).toBe(`work done for ${slug}\n`);
		}
	});
});
