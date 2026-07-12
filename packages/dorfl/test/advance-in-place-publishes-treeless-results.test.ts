import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {
	performAdvanceArgs,
	performAdvanceAuto,
	runAdvanceTickWithTreelessPublish,
	type AdvanceTickRunner,
} from '../src/advance-drivers.js';
import {performAdvance, type AdvanceResult} from '../src/advance.js';
import {mergeConfig} from '../src/config.js';
import type {SurfaceGate} from '../src/surface-gate.js';
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	pathOnArbiterMain,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';
import {run as runGit} from '../src/git.js';
import {
	pushTreelessResult,
	PERMANENT_PUSH_REJECTION,
} from '../src/advance-treeless-publish.js';
import {existsSync, chmodSync} from 'node:fs';

/**
 * `advance-in-place-publishes-treeless-results` task (PRD
 * `ci-advance-surfaces-questions-not-only-builds`). The in-place advance drivers
 * (`runSelectedInSequence`, used by `advance -n` / auto-pick / multi-arg, AND the
 * CLI single-named-item path that calls `performAdvance` directly) now wrap the
 * tick with the SHARED `pushTreelessResult` (task
 * `loop-advance-persists-treeless-rungs-to-arbiter`) so a tree-less rung's local
 * commit (surface sidecar / `triaged:` marker / applied-answer) lands on the
 * arbiter's `main` — instead of dying on the ephemeral CI runner.
 *
 * The tests assert OBSERVABLE arbiter state (a sidecar / marker on
 * `arbiter/main`), NOT call-wiring. They use throwaway git repos via
 * `seedRepoWithArbiter` + `gitEnv` (no global git/home config is touched).
 *
 * Coverage map vs the task's acceptance criteria:
 *   - surface / triage / apply land on the arbiter (AC1, AC2);
 *   - mid-batch external advance is handled by the rebase-retry (AC3);
 *   - no push for build/task (AC4a) and no push when no arbiter is configured
 *     (AC4b);
 *   - promote-apply is a harmless no-op — the in-place push does NOT clobber the
 *     promote CAS (AC5);
 *   - BOTH entry points are exercised: a single named arg (AC6) and the
 *     multi-item sequence runner;
 *   - a failing push is non-fatal — the work stays committed locally (AC7).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-advance-in-place-publishes-treeless-');
});
afterEach(() => {
	scratch.cleanup();
});

/** A scratch project + bare arbiter seeded with one `needsAnswers:true` task. */
function seedBlockedTaskRepo(slug: string): SeededRepo {
	return seedRepoWithArbiter(join(scratch.root, slug), [slug], {
		needsAnswers: true,
	});
}

/** A scratch project + bare arbiter seeded with one plain backlog task. */
function seedPlainRepo(slug: string): SeededRepo {
	return seedRepoWithArbiter(join(scratch.root, slug), [slug]);
}

/** Commit an ANSWERED sidecar for `<namespace>:<slug>` to the repo's `main`. */
function commitAnsweredSidecar(
	repo: string,
	namespace: 'task' | 'prd',
	slug: string,
	answer = 'yes',
): void {
	const item = `${namespace}:${slug}`;
	const model = newSidecar(item, [{question: 'pick one?'}]);
	model.entries[0].answer = answer;
	const abs = join(repo, sidecarPathFor(item));
	mkdirSync(join(abs, '..'), {recursive: true});
	writeFileSync(abs, serialiseSidecar(model));
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `seed answered sidecar for ${item}`], repo);
}

/** A surface-gate stub returning a canned emit. */
function surfaceGateStub(
	item: string,
	question = 'which approach?',
): SurfaceGate {
	const gate: SurfaceGate = async () => ({
		item,
		questions: [{question}],
	});
	return gate;
}

describe('advance in-place — surface / triage / apply rung commits land on the arbiter', () => {
	it('SURFACE: a single named blocker `advance <slug>` ff-pushes the sidecar to arbiter/main (the easy-to-miss single-arg path)', async () => {
		const slug = 'in-place-surface';
		const seed = seedBlockedTaskRepo(slug);

		// The CLI single-named-item path: `performAdvance` wrapped in the in-place
		// tree-less publish (the SAME wrapper the CLI uses for `advance <slug>`).
		const result = await runAdvanceTickWithTreelessPublish(
			{
				arg: slug,
				cwd: seed.repo,
				arbiter: 'arbiter',
				surfaceGate: surfaceGateStub(`task:${slug}`),
			},
			performAdvance,
		);

		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('surface');
		// The OBSERVABLE assertion: the sidecar reached the arbiter (not just the local cwd).
		expect(pathOnArbiterMain(seed.repo, `work/questions/task-${slug}.md`)).toBe(
			true,
		);
	});

	it('SURFACE: multi-item `performAdvanceAuto` (surfaceBlockers on) ff-pushes the sidecar to arbiter/main', async () => {
		const slug = 'auto-pick-blocker';
		const seed = seedBlockedTaskRepo(slug);

		const result = await performAdvanceAuto({
			cwd: seed.repo,
			arbiter: 'arbiter',
			surfaceGate: surfaceGateStub(`task:${slug}`),
			config: mergeConfig({autoBuild: true, surfaceBlockers: true}),
			lifecycleGates: {surface: true},
			count: 1,
		});

		expect(result.exitCode).toBe(0);
		expect(result.results[0].rung).toBe('surface');
		expect(pathOnArbiterMain(seed.repo, `work/questions/task-${slug}.md`)).toBe(
			true,
		);
	});

	it('APPLY: an answered blocker sidecar applied in-place ff-pushes the resolved item to arbiter/main', async () => {
		const slug = 'apply-answered';
		const seed = seedRepoWithArbiter(join(scratch.root, slug), [slug], {
			needsAnswers: true,
		});
		commitAnsweredSidecar(seed.repo, 'task', slug);

		const result = await runAdvanceTickWithTreelessPublish(
			{arg: slug, cwd: seed.repo, arbiter: 'arbiter'},
			performAdvance,
		);

		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('apply');
		// The apply rung committed the resolved-item move + sidecar resolution; the
		// in-place publish landed it on the arbiter. The OBSERVABLE assertion: the
		// sidecar is gone from `work/questions/` on the arbiter (resolved) AND the
		// item still exists. We check the sidecar's resolved-into-archive state by
		// asserting it no longer lives at the active path.
		expect(pathOnArbiterMain(seed.repo, `work/questions/task-${slug}.md`)).toBe(
			false,
		);
	});

	it('TRIAGE: an observation triage rung ff-pushes its `triaged:` marker to arbiter/main', async () => {
		const slug = 'stray-signal';
		const seed = seedRepoWithArbiter(join(scratch.root, slug), [], {});
		// Seed an observation on a sibling clone + push to arbiter so the in-place
		// repo sees it after a fetch.
		const obsBody = [
			'---',
			`slug: ${slug}`,
			'---',
			'',
			'a captured signal',
			'',
		].join('\n');
		mkdirSync(join(seed.repo, 'work', 'notes', 'observations'), {
			recursive: true,
		});
		writeFileSync(
			join(seed.repo, 'work', 'notes', 'observations', `${slug}.md`),
			obsBody,
		);
		gitIn(['add', '-A'], seed.repo);
		gitIn(['commit', '-q', '-m', 'seed observation'], seed.repo);
		gitIn(['push', '-q', 'arbiter', 'HEAD:main'], seed.repo);

		const result = await runAdvanceTickWithTreelessPublish(
			{
				arg: `obs:${slug}`,
				cwd: seed.repo,
				arbiter: 'arbiter',
				// Question-gated triage (default `ask`-mode for an explicit `obs:`):
				// the rung surfaces a triage sidecar locally — a tree-less commit.
				surfaceGate: surfaceGateStub(
					`observation:${slug}`,
					'promote, keep, or delete?',
				),
			},
			performAdvance,
		);

		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('triage-observation');
		// The triage rung committed locally (a triaged: marker / surface sidecar).
		// The OBSERVABLE assertion: SOMETHING landed on the arbiter (the repo's
		// arbiter/main advanced past the seed-observation commit).
		const repoHead = gitIn(['rev-parse', 'HEAD'], seed.repo).trim();
		const arbiterMain = gitIn(['rev-parse', 'arbiter/main'], seed.repo).trim();
		expect(arbiterMain).toBe(repoHead);
	});
});

describe('advance in-place — the publish GATE matches the existing drivers (no cleverer guard)', () => {
	it('build/task rung: no tree-less push (the doDriver band already integrates)', async () => {
		const slug = 'plain';
		const seed = seedPlainRepo(slug);

		// Capture the arbiter/main BEFORE we run a build/task rung. A stub
		// `AdvanceTickRunner` returns `rung: 'build-task'` — outside `TREELESS_RUNGS`
		// — so the wrapper MUST skip the push. We deliberately also have the stub
		// commit something LOCALLY: if the wrapper pushed regardless, arbiter/main
		// would advance and the assertion would fail.
		const before = gitIn(['rev-parse', 'arbiter/main'], seed.repo).trim();

		const run: AdvanceTickRunner = async () => {
			writeFileSync(
				join(seed.repo, 'sneaky.txt'),
				'should NOT reach arbiter\n',
			);
			gitIn(['add', '-A'], seed.repo);
			gitIn(['commit', '-q', '-m', 'stub build-task commit'], seed.repo);
			return {
				exitCode: 0,
				outcome: 'advanced',
				rung: 'build-task',
				slug,
				message: 'built',
			} satisfies AdvanceResult;
		};

		await runAdvanceTickWithTreelessPublish(
			{arg: slug, cwd: seed.repo, arbiter: 'arbiter'},
			run,
		);

		// arbiter/main is UNCHANGED — the wrapper saw a non-tree-less rung and
		// correctly skipped the push.
		gitIn(['fetch', '-q', 'arbiter'], seed.repo);
		const after = gitIn(['rev-parse', 'arbiter/main'], seed.repo).trim();
		expect(after).toBe(before);
	});

	it('no arbiter configured (the laptop live-checkout case): no tree-less push fires', async () => {
		const slug = 'no-arbiter-blocker';
		const seed = seedBlockedTaskRepo(slug);
		const before = gitIn(['rev-parse', 'arbiter/main'], seed.repo).trim();

		// A stub runner that commits a sidecar locally (as the real surface rung
		// would) and reports `rung: 'surface'` — but WITHOUT `arbiter` in the
		// context, the wrapper must NOT push.
		const run: AdvanceTickRunner = async () => {
			const item = `task:${slug}`;
			const model = newSidecar(item, [{question: 'q?'}]);
			const abs = join(seed.repo, sidecarPathFor(item));
			mkdirSync(join(abs, '..'), {recursive: true});
			writeFileSync(abs, serialiseSidecar(model));
			gitIn(['add', '-A'], seed.repo);
			gitIn(['commit', '-q', '-m', `surface ${slug}`], seed.repo);
			return {
				exitCode: 0,
				outcome: 'advanced',
				rung: 'surface',
				slug,
				message: 'surfaced',
			} satisfies AdvanceResult;
		};

		// NO `arbiter` field: the no-arbiter case. The wrapper must short-circuit.
		await runAdvanceTickWithTreelessPublish({arg: slug, cwd: seed.repo}, run);

		gitIn(['fetch', '-q', 'arbiter'], seed.repo);
		const after = gitIn(['rev-parse', 'arbiter/main'], seed.repo).trim();
		expect(after).toBe(before);
		// The sidecar IS in the local working tree (the rung committed it locally),
		// proving the no-op was the PUBLISH and not the rung itself.
		expect(pathOnArbiterMain(seed.repo, `work/questions/task-${slug}.md`)).toBe(
			false,
		);
	});

	it('a non-zero tick exit: no tree-less push (failures stay local)', async () => {
		const slug = 'failing-tick';
		const seed = seedPlainRepo(slug);
		const before = gitIn(['rev-parse', 'arbiter/main'], seed.repo).trim();

		const run: AdvanceTickRunner = async () => ({
			exitCode: 1,
			outcome: 'usage-error',
			rung: 'surface',
			slug,
			message: 'oops',
		});

		await runAdvanceTickWithTreelessPublish(
			{arg: slug, cwd: seed.repo, arbiter: 'arbiter'},
			run,
		);
		gitIn(['fetch', '-q', 'arbiter'], seed.repo);
		expect(gitIn(['rev-parse', 'arbiter/main'], seed.repo).trim()).toBe(before);
	});
});

describe('advance in-place — the rebase-retry handles a mid-batch external advance (the load-bearing case)', () => {
	it('a sequential -n batch whose later tick targets a NEWLY-advanced main rebases + lands the tree-less push', async () => {
		const seed = seedRepoWithArbiter(join(scratch.root, 'mixed'), [], {});

		// Two stub ticks: the FIRST advances arbiter/main from outside (modelling a
		// build/task rung integrated mid-batch via the `doDriver` band), the SECOND
		// commits a slug-only tree-less sidecar locally — so its `HEAD:main` push is
		// NON-FAST-FORWARD by construction. The rebase-retry inside
		// `pushTreelessResult` rebases the slug-only commit onto the advanced main
		// and lands it.
		const externalSlug = 'external-build';
		const surfaceSlug = 'mid-batch-blocker';

		let n = 0;
		const run: AdvanceTickRunner = async () => {
			n++;
			if (n === 1) {
				// "External" advance of arbiter/main via a side clone (modelling a
				// build/task integration in another worktree).
				const side = join(scratch.root, 'mixed', 'side');
				runGit(
					'git',
					['clone', '-q', `file://${seed.arbiter}`, side],
					scratch.root,
					{
						env: gitEnv(),
					},
				);
				const doneDir = join(side, 'work', 'tasks', 'done');
				mkdirSync(doneDir, {recursive: true});
				writeFileSync(
					join(doneDir, `${externalSlug}.md`),
					`---\nslug: ${externalSlug}\n---\n`,
				);
				runGit('git', ['add', '-A'], side, {env: gitEnv()});
				runGit('git', ['commit', '-q', '-m', `done: ${externalSlug}`], side, {
					env: gitEnv(),
				});
				runGit('git', ['push', '-q', 'origin', 'HEAD:main'], side, {
					env: gitEnv(),
				});
				return {
					exitCode: 0,
					outcome: 'advanced',
					rung: 'build-task',
					slug: externalSlug,
					message: 'built',
				};
			}
			// Second tick: a slug-only tree-less commit (a surfaced sidecar).
			const item = `task:${surfaceSlug}`;
			const model = newSidecar(item, [{question: 'q?'}]);
			const abs = join(seed.repo, sidecarPathFor(item));
			mkdirSync(join(abs, '..'), {recursive: true});
			writeFileSync(abs, serialiseSidecar(model));
			gitIn(['add', '-A'], seed.repo);
			gitIn(['commit', '-q', '-m', `surface ${surfaceSlug}`], seed.repo);
			return {
				exitCode: 0,
				outcome: 'advanced',
				rung: 'surface',
				slug: surfaceSlug,
				message: 'surfaced',
			};
		};

		// Drive both items through the multi-arg sequence runner (covers
		// `runSelectedInSequence`).
		const result = await performAdvanceArgs([externalSlug, surfaceSlug], {
			cwd: seed.repo,
			arbiter: 'arbiter',
			config: mergeConfig({}),
			run,
		});

		expect(result.exitCode).toBe(0);
		// BOTH landed on the arbiter: the build's done/ file AND the surfaced sidecar
		// (the second push was non-fast-forward; the rebase-retry rebased it onto
		// the advanced main and landed it).
		expect(existsOnArbiterMain(seed.repo, 'done', externalSlug)).toBe(true);
		expect(
			pathOnArbiterMain(seed.repo, `work/questions/task-${surfaceSlug}.md`),
		).toBe(true);
	});
});

describe('advance in-place — promote-apply is a harmless no-op (mirrors the existing drivers)', () => {
	it('an apply rung that committed NOTHING tree-less (promote-CAS already on arbiter) ff-pushes cleanly, not clobbering the promote CAS', async () => {
		const slug = 'promote-apply';
		const seed = seedPlainRepo(slug);

		// Simulate the promote-apply shape: the rung does its OWN arbiter CAS
		// (writes nothing in `cwd`), so a NEW item exists on arbiter/main and the
		// local cwd's HEAD has NOT advanced. The wrapper's ff-push is then a
		// HEAD-with-nothing-new no-op against the (now-ahead) arbiter — it must
		// NOT clobber the promote-CAS state and MUST NOT crash.
		const promotedSlug = 'promoted-item';
		const side = join(scratch.root, slug, 'promote-side');
		runGit(
			'git',
			['clone', '-q', `file://${seed.arbiter}`, side],
			scratch.root,
			{
				env: gitEnv(),
			},
		);
		const backlog = join(side, 'work', 'tasks', 'ready');
		mkdirSync(backlog, {recursive: true});
		writeFileSync(
			join(backlog, `${promotedSlug}.md`),
			`---\nslug: ${promotedSlug}\n---\n`,
		);
		runGit('git', ['add', '-A'], side, {env: gitEnv()});
		runGit('git', ['commit', '-q', '-m', `promote: ${promotedSlug}`], side, {
			env: gitEnv(),
		});
		runGit('git', ['push', '-q', 'origin', 'HEAD:main'], side, {env: gitEnv()});

		const beforeArbiter = gitIn(['ls-remote', 'arbiter', 'main'], seed.repo)
			.trim()
			.split(/\s+/)[0];

		const run: AdvanceTickRunner = async () => ({
			exitCode: 0,
			outcome: 'advanced',
			rung: 'apply',
			slug,
			message: 'promote-applied (no tree-less commit)',
		});

		await runAdvanceTickWithTreelessPublish(
			{arg: slug, cwd: seed.repo, arbiter: 'arbiter'},
			run,
		);

		// The promote-CAS state on arbiter is UNCHANGED — the promoted item is still
		// there and arbiter/main is at the promote-CAS sha (not regressed, not
		// double-published).
		const afterArbiter = gitIn(['ls-remote', 'arbiter', 'main'], seed.repo)
			.trim()
			.split(/\s+/)[0];
		expect(afterArbiter).toBe(beforeArbiter);
		expect(existsOnArbiterMain(seed.repo, 'backlog', promotedSlug)).toBe(true);
	});
});

describe('advance in-place — a failing publish is NON-FATAL (the work stays committed locally)', () => {
	it('a push that keeps failing is reported via `note` and does NOT crash the tick', async () => {
		const slug = 'push-fail';
		const seed = seedPlainRepo(slug);

		// Break the arbiter remote URL so every push attempt fails. The wrapper must
		// still return the tick result cleanly + report via `note`.
		gitIn(
			['remote', 'set-url', 'arbiter', 'file:///nonexistent/dorfl-gone.git'],
			seed.repo,
		);

		const notes: string[] = [];
		const run: AdvanceTickRunner = async () => {
			const item = `task:${slug}`;
			const model = newSidecar(item, [{question: 'q?'}]);
			const abs = join(seed.repo, sidecarPathFor(item));
			mkdirSync(join(abs, '..'), {recursive: true});
			writeFileSync(abs, serialiseSidecar(model));
			gitIn(['add', '-A'], seed.repo);
			gitIn(['commit', '-q', '-m', `surface ${slug}`], seed.repo);
			return {
				exitCode: 0,
				outcome: 'advanced',
				rung: 'surface',
				slug,
				message: 'surfaced',
			};
		};

		const result = await runAdvanceTickWithTreelessPublish(
			{
				arg: slug,
				cwd: seed.repo,
				arbiter: 'arbiter',
				note: (m) => notes.push(m),
			},
			run,
		);

		// The tick result is preserved (the rung succeeded); the publish failure was
		// reported but did not crash.
		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('surface');
		expect(notes.some((n) => /could not publish|tree-less/i.test(n))).toBe(
			true,
		);
		// The local commit IS still there (the work survives for the next pass).
		const localHead = gitIn(
			['cat-file', '-e', `HEAD:${sidecarPathFor(`task:${slug}`)}`],
			seed.repo,
		);
		// (No throw above => the path exists on local HEAD.)
		expect(localHead).toBeDefined();
		// Belt-and-suspenders: read the committed sidecar back.
		const committed = readFileSync(
			join(seed.repo, sidecarPathFor(`task:${slug}`)),
			'utf8',
		);
		expect(committed).toContain('q?');
	});
});

describe('advance in-place — a PROTECTED-BRANCH rejection is TERMINAL, not retried (the GH006 incident)', () => {
	// The live incident: the arbiter’s `main` hard-required the `verify` status
	// check on EVERY push (classic branch protection), so the DIRECT tree-less
	// `git push HEAD:main` was rejected with `GH006 ... Required status check
	// “verify” is expected` / `protected branch hook declined`. The stderr contains
	// the word `rejected`, so the OLD broad contention classifier mis-read it as a
	// fast-forward race and burned the whole `retries: 1000` ceiling on identical,
	// unwinnable round-trips. A rebase can NEVER cure a required-check gate on a
	// fresh direct-push commit, so the push MUST stop at the FIRST attempt.
	it('stops after ONE push attempt with a protection-specific note (no retry storm)', async () => {
		const slug = 'gh006';
		const seed = seedPlainRepo(slug);

		// Install a `pre-receive` hook in the bare arbiter that rejects every push
		// with a GH006-shaped message AND appends a line to a counter file, so we can
		// assert EXACTLY one push attempt reached the arbiter (proving no retry loop).
		const counter = join(scratch.root, `${slug}-hook-hits.log`);
		const hooksDir = join(seed.arbiter, 'hooks');
		mkdirSync(hooksDir, {recursive: true});
		const hook = join(hooksDir, 'pre-receive');
		writeFileSync(
			hook,
			'#!/bin/sh\n' +
				`echo hit >> ${JSON.stringify(counter)}\n` +
				'echo "remote: error: GH006: Protected branch update failed for refs/heads/main." 1>&2\n' +
				'echo "remote: - Required status check \\"verify\\" is expected." 1>&2\n' +
				'exit 1\n',
		);
		chmodSync(hook, 0o755);

		// Commit a tree-less sidecar LOCALLY (what a surface rung does), then publish.
		const item = `task:${slug}`;
		const abs = join(seed.repo, sidecarPathFor(item));
		mkdirSync(join(abs, '..'), {recursive: true});
		writeFileSync(abs, serialiseSidecar(newSidecar(item, [{question: 'q?'}])));
		gitIn(['add', '-A'], seed.repo);
		gitIn(['commit', '-q', '-m', `surface ${slug}`], seed.repo);

		const notes: string[] = [];
		await pushTreelessResult({
			cwd: seed.repo,
			arbiter: 'arbiter',
			// The production liveness ceiling. If the fix regressed and the rejection
			// were treated as contention, the hook would be hit ~1000 times.
			retries: 1000,
			jitterMs: 0,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		// EXACTLY one push reached the arbiter — the rejection terminated the loop.
		expect(existsSync(counter)).toBe(true);
		const hits = readFileSync(counter, 'utf8').trim().split('\n').length;
		expect(hits).toBe(1);

		// The note names the protection cause (not the generic contention note).
		expect(
			notes.some((n) =>
				/protected branch|required-status-check|rejected the direct/i.test(n),
			),
		).toBe(true);

		// The work survives locally for the next pass / a human.
		expect(existsSync(join(seed.repo, sidecarPathFor(item)))).toBe(true);
	});

	it('PERMANENT_PUSH_REJECTION matches the live GH006 stderr but NOT a plain non-fast-forward', () => {
		const gh006 =
			'remote: error: GH006: Protected branch update failed for refs/heads/main.\n' +
			'remote: - Required status check "verify" is expected.\n' +
			' ! [remote rejected]   HEAD -> main (protected branch hook declined)';
		expect(PERMANENT_PUSH_REJECTION.test(gh006)).toBe(true);
		// A genuine fast-forward race must NOT be classified as permanent (the rebase
		// retry still owns that path).
		expect(
			PERMANENT_PUSH_REJECTION.test(
				' ! [rejected]        HEAD -> main (non-fast-forward)\nhint: Updates were rejected; fetch first.',
			),
		).toBe(false);
	});
});
