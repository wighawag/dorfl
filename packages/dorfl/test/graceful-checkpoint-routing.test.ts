/**
 * End-to-end deadline-checkpoint routing (spec `graceful-pre-timeout-wip-checkpoint`):
 * inject a fast deadline via a stub `DoDorfl` that returns `{ok:false, timedOut:true}`,
 * and assert `performDo` routes it AUTO-CONTINUE / SURFACE per the progress + ceiling gates.
 *
 * The stub `DoDorfl` also EDITS a file so the work branch carries a diff
 * (`isWorkBranchDiffEmpty` returns false ⇒ "progress this session") — the
 * auto-continue branch. A control test uses a no-op stub (no edits ⇒ no
 * progress) to exercise the SURFACE branch.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performDo, type DoDorfl} from '../src/do.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	stuckLockOnArbiter,
	sidecarSurfacedOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('graceful-checkpoint-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('deadline checkpoint routing — auto-continue on progress under the ceiling', () => {
	it('AUTO-CONTINUE: WIP saved + branch on arbiter + lock RELEASED + no sidecar + exit 0', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// The stub `DoDorfl` EDITS a file (so the work branch carries a real
		// source diff ahead of main — `isWorkBranchDiffEmpty` reads false ⇒
		// PROGRESS this session), then reports the dorfl-internal DEADLINE fired.
		const timeoutAgent: DoDorfl = ({cwd}) => {
			writeFileSync(join(cwd, 'checkpoint-work.txt'), 'partial work\n');
			return {ok: false, timedOut: true};
		};

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			dorfl: timeoutAgent,
			env: gitEnv(),
			// Well above the 1 checkpoint that will be produced.
			maxAutoCheckpoints: 5,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('deadline-auto-continued');
		expect(result.message).toMatch(/auto-continued/);
		// No stuck-lock (auto-continue must not mark the item stuck).
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		// No sidecar surfaced (auto-continue is silent — no human in the loop).
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(false);
		// The work branch was pushed to the arbiter (RECOVERABLE half): the next
		// tick's claim continues from its tip.
		run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
		const branchTip = gitIn(
			[
				'rev-parse',
				'--verify',
				'--quiet',
				`${ARBITER}/work/task-alpha^{commit}`,
			],
			repo,
		).trim();
		expect(branchTip).not.toBe('');
		// The saved WIP commit is present on the branch (its subject carries the
		// distinct deadline-checkpoint marker so the counter can enumerate it).
		const subjects = gitIn(
			['log', '--format=%s', `${ARBITER}/main..${ARBITER}/work/task-alpha`],
			repo,
		);
		expect(subjects).toMatch(/chore\(deadline-checkpoint\)/);
	});

	it('SURFACE on no progress: injected deadline + no edits ⇒ sidecar surfaced (anti-loop guard)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['bravo']);
		// The stub does NOT edit anything (the tree is clean), simulating a wedged
		// agent that made no progress before the deadline fired. The routing MUST
		// surface a needsAnswers question (a human decides) rather than
		// auto-continuing — the anti-loop guard.
		const noProgressAgent: DoDorfl = () => ({ok: false, timedOut: true});

		const result = await performDo({
			arg: 'bravo',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			dorfl: noProgressAgent,
			env: gitEnv(),
			maxAutoCheckpoints: 5,
		});

		expect(result.outcome).toBe('deadline-surfaced');
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/no progress/);
		// The whole applyNeedsAttentionTransition ran (save + mark stuck).
		expect(stuckLockOnArbiter(repo, 'bravo')).toBe(true);
	});

	it('SURFACE on ceiling: maxAutoCheckpoints = 0 forces the ceiling on the first checkpoint', async () => {
		// A hard ceiling of 0 means EVERY deadline checkpoint surfaces regardless
		// of progress — the anti-loop guard's terminal behaviour. This proves the
		// counter/ceiling comparison, without needing to script N runs.
		const {repo} = seedRepoWithArbiter(scratch.root, ['charlie']);
		const timeoutAgentWithProgress: DoDorfl = ({cwd}) => {
			writeFileSync(join(cwd, 'checkpoint-work.txt'), 'partial\n');
			return {ok: false, timedOut: true};
		};

		const result = await performDo({
			arg: 'charlie',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			dorfl: timeoutAgentWithProgress,
			env: gitEnv(),
			// Ceiling of 0 — a single checkpoint already hits it, so the routing
			// MUST surface (never auto-continue) even though progress was made.
			maxAutoCheckpoints: 0,
		});

		expect(result.outcome).toBe('deadline-surfaced');
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/ceiling/);
		expect(stuckLockOnArbiter(repo, 'charlie')).toBe(true);
	});
});
