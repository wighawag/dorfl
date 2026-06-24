import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, readFileSync, chmodSync} from 'node:fs';
import {performTask, type TaskDorfl} from '../src/tasking.js';
import {GitHubProvider} from '../src/github.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * `do prd:<slug>` TASK-OUTPUT-THROUGH-INTEGRATION tests (task
 * `task-output-through-integration`). The KEYSTONE behaviour: the produced
 * `work/tasks/ready/*` tasks integrate through the SHARED `performIntegration` core
 * (`src/integration-core.ts`) honoring `--propose`/`--merge`, instead of
 * committing straight to `main` via the lock's `emitTasks`.
 *
 * House style (mirrors `run-integration-core.test.ts`): a throwaway checkout + a
 * local `--bare` arbiter + a STUBBED agent (writes task files directly). The
 * propose test puts a recording `gh` stub on PATH (no real GitHub) + `provider:
 * 'github'` to drive the real propose pipeline. `GIT_CONFIG_GLOBAL` isolation +
 * `isolatePiAgentDir` keep the developer's real config/sessions untouched.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-tasking-int-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/** Seed a `work/prds/ready/<slug>.md` (committed onto the arbiter). */
function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'prds', 'ready');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug} — task me`,
			`slug: ${slug}`,
			'---',
			'',
			'## Problem Statement',
			'',
			`PRD body for ${slug}.`,
			'',
		].join('\n'),
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `prd: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/**
 * Seed a `work/prds/ready/<slug>.md` STAMPED with origin-trust provenance (task
 * `untrusted-origin-forces-build-propose`) — an intake-born prd whose stamp the
 * tasker must PROPAGATE onto every emitted task.
 */
function seedPrdWithOrigin(
	repo: string,
	slug: string,
	originTrust: 'trusted' | 'untrusted',
): void {
	const dir = join(repo, 'work', 'prds', 'ready');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug} — task me`,
			`slug: ${slug}`,
			'origin: issue',
			`originTrust: ${originTrust}`,
			'---',
			'',
			'## Problem Statement',
			'',
			`PRD body for ${slug}.`,
			'',
		].join('\n'),
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `prd: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** An agent that writes one backlog task file (no git). */
function taskingAgent(file = 'child'): TaskDorfl {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'tasks', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${file}.md`),
			[
				'---',
				`title: ${file}`,
				`slug: ${file}`,
				'prd: it',
				'---',
				'',
				'## Prompt',
				'',
				'> build it',
				'',
			].join('\n'),
		);
		return {ok: true};
	};
}

/** The arbiter's `main` tip subject (after fetch). */
function arbiterHeadSubject(repo: string): string {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return run('git', ['log', '-1', '--format=%s', `${ARBITER}/main`], repo, {
		env: gitEnv(),
	}).stdout.trim();
}

const onArbiterMain = (repo: string, path: string): boolean => {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
};

const onArbiterBranch = (
	repo: string,
	branch: string,
	path: string,
): boolean => {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/${branch}:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
};

describe('do prd: output through performIntegration — --merge lands on main', () => {
	it('integrates the tasks + the PRD lifecycle move onto arbiter main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('tasked');
		// The produced task + the prd lifecycle move (tasking/ -> prd-tasked/) all
		// landed on the arbiter main, through the shared core (not the lock's direct
		// commit). The prd now rests in prd-tasked/ (the source of truth for
		// tasked-ness — residence, no marker), NOT back in prd/.
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/prds/tasked/it.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/prds/ready/it.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/tasking/it.md')).toBe(false);
		const prd = run(
			'git',
			['show', `${ARBITER}/main:work/prds/tasked/it.md`],
			repo,
			{env: gitEnv()},
		).stdout;
		// Tasked-ness is RESIDENCE in prd-tasked/ (asserted above); the `tasked:` marker
		// was removed entirely in remove-tasked-marker-step-b, so the resting prd carries
		// NO tasked: line.
		expect(prd).not.toMatch(/^tasked:/m);
		// It is the shared core's integrate commit (`tasking(<slug>): …; tasked`),
		// not the lock's `tasking: release …` direct commit.
		expect(arbiterHeadSubject(repo)).toMatch(/^tasking\(it\):/);
	});
});

describe('do prd: output through performIntegration — --propose opens a PR, main untouched', () => {
	it('pushes the work branch + opens a PR carrying the tasks; does NOT touch main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');

		// A recording `gh` stub (no real GitHub), injected as the GitHub provider
		// INSTANCE (the provider is arbiter-derived now — the instance seam drives it).
		const binDir = join(scratch.root, 'gh-stub');
		mkdirSync(binDir, {recursive: true});
		const argsFile = join(binDir, 'gh-args.txt');
		const gh = join(binDir, 'gh');
		writeFileSync(
			gh,
			[
				'#!/usr/bin/env bash',
				`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
				"printf '%s\\n' 'https://github.com/o/r/pull/7'",
				'exit 0',
			].join('\n') + '\n',
		);
		chmodSync(gh, 0o755);

		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh}),
			dorfl: taskingAgent('child'),
			env: {...gitEnv(), PATH: `${binDir}:${process.env.PATH ?? ''}`},
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('tasked');

		// The tasks are NOT on main (propose does not land them); the prd body STAYS
		// in prd/ on main (the lock is a ref now — it never moves the body; the PR
		// carries the prd → prd-tasked move). NO tasking/ marker.
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/prds/tasked/it.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/prds/ready/it.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasking/it.md')).toBe(false);
		// The OUTPUT never advanced main: the lock is a hidden ref (not a main commit),
		// and propose does not land the tasks — main is still the seed commit.
		expect(arbiterHeadSubject(repo)).not.toMatch(/tasked/);

		// The work branch was PUSHED carrying the tasks + the prd restore.
		expect(
			onArbiterBranch(repo, 'work/prd-it', 'work/tasks/backlog/child.md'),
		).toBe(true);
		expect(onArbiterBranch(repo, 'work/prd-it', 'work/prds/tasked/it.md')).toBe(
			true,
		);
		expect(onArbiterBranch(repo, 'work/prd-it', 'work/prds/ready/it.md')).toBe(
			false,
		);

		// A PR was opened (the recording gh stub captured a `pr create`).
		const args = readFileSync(argsFile, 'utf8');
		expect(args).toMatch(/^create$/m);
		expect(args).toMatch(/^--title$/m);
		expect(args).toContain('tasking(it)');
	});
});

describe('do prd: arg parity with do task: (the SAME integrate-time args resolve)', () => {
	// Arg PARITY by construction (AC #4): because `do prd:`'s output integrates
	// THROUGH the SAME `performIntegration` core `do task:` uses, every
	// integrate-time arg resolves IDENTICALLY on both paths — there is no duplicated
	// parser. A table over the integrate-MODE flag (`propose`/`merge`) proves the
	// resolution: the SAME `integration` value produces the SAME observable
	// integrate effect on the tasking path it produces on the build path (no-main
	// touch for propose, land-on-main for merge).
	const PARITY_TABLE: Array<{
		mode: 'propose' | 'merge';
		// The observable integrate effect the SHARED core resolves the mode to.
		landsOnMain: boolean;
	}> = [
		{mode: 'merge', landsOnMain: true},
		{mode: 'propose', landsOnMain: false},
	];

	for (const row of PARITY_TABLE) {
		it(`--${row.mode} resolves to ${row.landsOnMain ? 'land-on-main' : 'no-main-touch'} on the do prd: path (shared core)`, async () => {
			const {repo} = seedRepoWithArbiter(scratch.root, []);
			seedPrd(repo, 'it');
			const result = await performTask({
				slug: 'it',
				cwd: repo,
				arbiter: ARBITER,
				autoTask: true,
				// The integrate-time arg — the SAME knob `do task:`/`complete` thread into
				// `performIntegration.mode` — with NO tasking-specific parser.
				integration: row.mode,
				dorfl: taskingAgent('child'),
				env: gitEnv(),
			});
			expect(result.outcome).toBe('tasked');
			// The shared core resolved the mode to the SAME effect it resolves for a
			// build: merge lands the task on main; propose does not (it pushes the
			// `work/<slug>` branch + leaves main untouched, the PR source).
			expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(
				row.landsOnMain,
			);
			if (!row.landsOnMain) {
				// Propose pushed the work branch carrying the tasks (the SAME branch
				// `performIntegration` integrates on the build path).
				expect(
					onArbiterBranch(repo, 'work/prd-it', 'work/tasks/backlog/child.md'),
				).toBe(true);
			}
		});
	}
});

describe('do prd: PROPAGATES origin-trust onto emitted tasks (untrusted-origin-forces-build-propose)', () => {
	it('tasking an UNTRUSTED-origin PRD stamps every emitted task originTrust: untrusted', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrdWithOrigin(repo, 'it', 'untrusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			// Tasking may MERGE the task FILES onto main (a file is inert); the BUILD
			// transition is where untrusted bites. The propagation must happen here so
			// the build can later read it.
			integration: 'merge',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		const task = run(
			'git',
			['show', `${ARBITER}/main:work/tasks/backlog/child.md`],
			repo,
			{env: gitEnv()},
		).stdout;
		// The agent's task carried NO origin stamp; the runner PROPAGATED the prd's.
		expect(task).toMatch(/^origin: issue$/m);
		expect(task).toMatch(/^originTrust: untrusted$/m);
		// The agent-authored `prd:` link is preserved.
		expect(task).toMatch(/^prd: it$/m);
	});

	it('a TRUSTED-origin PRD propagates originTrust: trusted', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrdWithOrigin(repo, 'it', 'trusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		const task = run(
			'git',
			['show', `${ARBITER}/main:work/tasks/backlog/child.md`],
			repo,
			{env: gitEnv()},
		).stdout;
		expect(task).toMatch(/^originTrust: trusted$/m);
	});

	it('an UNSTAMPED (human/local) PRD propagates NOTHING — the normal path is untouched', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it'); // no origin/originTrust stamp
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		const task = run(
			'git',
			['show', `${ARBITER}/main:work/tasks/backlog/child.md`],
			repo,
			{env: gitEnv()},
		).stdout;
		expect(task).not.toMatch(/^origin:/m);
		expect(task).not.toMatch(/^originTrust:/m);
	});
});
