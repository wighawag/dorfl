import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
} from './helpers/gitRepo.js';

/**
 * Story 12 of `land-time-reverify-and-parallel-merge-ceiling`: the
 * load-bearing test for the whole brief's thesis — a clean-rebase merge that
 * is SEMANTICALLY broken. Two work branches, disjoint files, NO textual
 * conflict: A renames an exported function, B adds an import/caller of the
 * OLD name. Both rebase clean onto each other. The SECOND to land must FAIL
 * `verify` ON THE REBASED TIP (not the pre-rebase checkout) and route to the
 * stuck-lock surface — i.e. the clean rebase is NOT trusted, exactly as the
 * thesis "a clean git merge validates the AUTHORED context, never the LIVED
 * context" demands. Prior art: the fresh-worktree-gate tests in
 * `fresh-worktree-gate.test.ts` — same fixture/style.
 *
 * Assertions are external-behaviour (per the task `What to build`):
 *   1. `main` does NOT contain a tree that would fail `verify` after the
 *      second land (the second item never lands).
 *   2. The second item's per-item lock ends in `state: stuck` with a reason
 *      that names the failure as a re-verify failure ON THE REBASED TIP, NOT
 *      a rebase conflict.
 *   3. `verify` actually RAN on the rebased tree — observed via a marker the
 *      fake `verify` writes (the marker captures `util.js`'s content + the
 *      presence of `caller.js`, so we can prove the run saw the REBASED tree:
 *      A's rename AND B's new caller present together).
 *
 * Nothing in here asserts on which private function was called — the gate is
 * driven through `performIntegration`'s public outcome shape.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-clean-rebase-semantic-break-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * The committed-on-`main` baseline tree: the exported function lives in
 * `util.js` under its ORIGINAL name (`oldName`); `verify.js` is the project's
 * gate command — it appends a JSON line to `DORFL_TEST_MARKER` describing the
 * tree it was run against, then (if `caller.js` exists) requires it (which
 * fails iff `util.js` no longer exports `oldName`). caller.js is intentionally
 * NOT seeded — it is added only by branch B.
 */
const ORIGINAL_UTIL = "module.exports = { oldName: () => 'ok' };\n";
const RENAMED_UTIL = "module.exports = { newName: () => 'ok' };\n";
const CALLER_JS = "const m = require('./util.js');\nm.oldName();\n";
/**
 * The verify command (`node verify.js`). It records what tree it was run
 * against, then (when caller.js exists) requires it — so a tree with the
 * rename AND the caller (= the rebased-tip merged tree) FAILS verify, while
 * either branch alone (rename-only OR caller-only on top of the original
 * util.js) passes. The marker write happens BEFORE the require so the run is
 * observable even when verify exits non-zero.
 */
const VERIFY_JS = [
	"const fs = require('node:fs');",
	"const path = require('node:path');",
	'const marker = process.env.DORFL_TEST_MARKER;',
	"const util = fs.readFileSync('util.js', 'utf8');",
	"const callerExists = fs.existsSync('caller.js');",
	'if (marker) {',
	"  fs.appendFileSync(marker, JSON.stringify({ util, callerExists }) + '\\n');",
	'}',
	'if (callerExists) {',
	"  require(path.resolve('caller.js'));",
	'}',
	'',
].join('\n');

describe('land-time re-verify catches a clean-rebase-but-semantically-broken merge (Story 12)', () => {
	it('A renames an exported function, B adds a caller of the OLD name; both rebase clean, the SECOND to land FAILS verify on the rebased tip and the lock goes stuck', async () => {
		// 1. Seed: two task bodies in `tasks/ready/` + the project source files.
		//    We do TWO commits: (a) the fixture seed (the work/ tree), and then (b)
		//    write util.js + verify.js into the same clone and push so the bare
		//    arbiter carries them on `main` — both subsequent work branches must
		//    cut from a `main` that already has these files.
		const seeded = seedRepoWithArbiter(scratch.root, ['rename-a', 'caller-b']);
		writeFileSync(join(seeded.repo, 'util.js'), ORIGINAL_UTIL);
		writeFileSync(join(seeded.repo, 'verify.js'), VERIFY_JS);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'project: util.js + verify.js'], seeded.repo);
		gitIn(['push', '-q', ARBITER, 'main:main'], seeded.repo);

		// 2. The shared verify-marker — a path OUTSIDE any worktree (so it survives
		//    the throwaway-fresh-gate worktree reaping). The verify command writes
		//    one JSON line per gate run; the test reads it at the end.
		const markerPath = join(scratch.root, 'verify-marker.log');
		const verifyEnv = {...gitEnv(), DORFL_TEST_MARKER: markerPath};
		const verify = 'node verify.js';

		// 3. Branch A: claim `rename-a` in the primary clone, cut a work branch off
		//    the current `arbiter/main` (which has the ORIGINAL util.js), and edit
		//    util.js — the export's name changes from `oldName` to `newName`. The
		//    edit is UNCOMMITTED; `performIntegration` will commit it as part of
		//    the atomic done-move-and-work commit.
		const repoA = seeded.repo;
		await performClaim({
			slug: 'rename-a',
			cwd: repoA,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		gitIn(['fetch', '-q', ARBITER], repoA);
		gitIn(
			['switch', '-q', '-c', 'work/task-rename-a', `${ARBITER}/main`],
			repoA,
		);
		writeFileSync(join(repoA, 'util.js'), RENAMED_UTIL);

		// 4. Branch B: a SECOND independent clone (so branch A's uncommitted edits
		//    do not contaminate it), claim `caller-b`, cut a work branch off the
		//    same `arbiter/main` (= A's base; A has NOT landed yet so the bases are
		//    identical), and add a brand-new `caller.js` that calls the OLD name.
		//    A and B touch DISJOINT files (util.js vs caller.js) — no textual
		//    rebase conflict possible.
		const repoB = seeded.clone('caller-b');
		await performClaim({
			slug: 'caller-b',
			cwd: repoB,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		gitIn(['fetch', '-q', ARBITER], repoB);
		gitIn(
			['switch', '-q', '-c', 'work/task-caller-b', `${ARBITER}/main`],
			repoB,
		);
		writeFileSync(join(repoB, 'caller.js'), CALLER_JS);

		// 5. Land A first (mode: merge, so it lands on `arbiter/main` immediately).
		//    A's rebased tip has the rename but NO caller.js, so the verify (which
		//    only requires caller.js when it exists) PASSES — and A lands cleanly.
		const landedA = await performIntegration({
			cwd: repoA,
			arbiter: ARBITER,
			slug: 'rename-a',
			source: 'tasks-ready',
			recovering: false,
			freshWorktreeGate: true,
			verify,
			mode: 'merge',
			surfaceArbiter: ARBITER,
			env: verifyEnv,
		});
		expect(landedA.outcome).toBe('completed');
		expect(landedA.integration?.mergedToMain).toBe(true);
		expect(existsOnArbiterMain(repoA, 'done', 'rename-a')).toBe(true);

		// 6. Land B SECOND. B's branch was cut from the pre-rename `main`; its
		//    pre-rebase tree (util.js with `oldName` + B's new caller.js) would
		//    PASS verify. The fresh-worktree gate rebases B onto the CURRENT
		//    `arbiter/main` (which now carries A's rename) — disjoint files, the
		//    rebase is CLEAN, no textual conflict. THEN verify runs on the rebased
		//    tip, where util.js has `newName` but caller.js still requires
		//    `oldName` — so verify FAILS, exactly the headline of the brief.
		const landedB = await performIntegration({
			cwd: repoB,
			arbiter: ARBITER,
			slug: 'caller-b',
			source: 'tasks-ready',
			recovering: false,
			freshWorktreeGate: true,
			verify,
			mode: 'merge',
			surfaceArbiter: ARBITER,
			env: verifyEnv,
		});

		// 7a. EXTERNAL ASSERTION #1: B did NOT land. `main` does not carry a tree
		//     that would fail verify (no caller.js on main); B's body never reached
		//     `done/`.
		expect(landedB.outcome).toBe('gate-failed');
		expect(landedB.routedToNeedsAttention).toBe(true);
		expect(existsOnArbiterMain(repoB, 'done', 'caller-b')).toBe(false);

		// The merged tree on `main` is A's tree (rename only, no caller.js) — so a
		// fresh `node verify.js` against `main` would pass. Verify the absence of
		// caller.js on the arbiter directly: a `git cat-file -e` of the path is
		// expected to fail (path absent from arbiter/main).
		const catCaller = gitIn(['fetch', '-q', ARBITER], repoB);
		void catCaller; // fetch only; the absence check is via existsOnArbiterMain
		// stronger: caller.js never reached main
		const lsCaller = gitIn(
			['ls-tree', `${ARBITER}/main`, 'caller.js'],
			repoB,
		).trim();
		expect(lsCaller).toBe('');

		// 7b. EXTERNAL ASSERTION #2: B's per-item lock ends in `state: stuck`,
		//     with a reason that names the REBASED-TIP re-verify failure — NOT a
		//     rebase conflict.
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repoB, 'caller-b')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repoB, 'caller-b')).toBe(true);
		expect(needsAnswersOnArbiterMain(repoB, 'caller-b')).toBe(true);
		const lock = await readItemLock({
			item: 'task:caller-b',
			cwd: repoB,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// PR-2b: post-bounce the lock is RELEASED; the reason lives on the surfaced
		// sidecar (`<arbiter>/main`).
		expect(lock).toBeUndefined();
		gitIn(['fetch', '-q', ARBITER], repoB);
		const sidecar = gitIn(
			['show', `${ARBITER}/main:work/questions/task-caller-b.md`],
			repoB,
		);
		expect(sidecar).toMatch(/acceptance gate failed/i);
		expect(sidecar).toMatch(/rebased tip/i);
		expect(sidecar).not.toMatch(/rebase.*conflict/i);

		// 7c. EXTERNAL ASSERTION #3: verify actually RAN on the rebased tree. The
		//     marker file captures one JSON line per gate run; at least one of B's
		//     entries must show BOTH A's rename (util.js exports `newName`) AND
		//     B's caller.js (callerExists: true) — that combined state ONLY exists
		//     on the rebased tip (the pre-rebase tree had `oldName` + caller.js;
		//     A's tree had `newName` + no caller.js).
		expect(existsSync(markerPath)).toBe(true);
		const marker = readFileSync(markerPath, 'utf8');
		const lines = marker
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== '')
			.map((line) => JSON.parse(line) as {util: string; callerExists: boolean});
		const rebasedTipRun = lines.find(
			(entry) => entry.callerExists && /newName/.test(entry.util),
		);
		expect(rebasedTipRun).toBeDefined();
	});
});
