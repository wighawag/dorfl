import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, readFileSync, chmodSync} from 'node:fs';
import {performSlice, type SliceAgentRunner} from '../src/slicing.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * `do prd:<slug>` SLICE-OUTPUT-THROUGH-INTEGRATION tests (slice
 * `slice-output-through-integration`). The KEYSTONE behaviour: the produced
 * `work/backlog/*` slices integrate through the SHARED `performIntegration` core
 * (`src/integration-core.ts`) honoring `--propose`/`--merge`, instead of
 * committing straight to `main` via the lock's `emitSlices`/`markSliced`.
 *
 * House style (mirrors `run-integration-core.test.ts`): a throwaway checkout + a
 * local `--bare` arbiter + a STUBBED agent (writes slice files directly). The
 * propose test puts a recording `gh` stub on PATH (no real GitHub) + `provider:
 * 'github'` to drive the real propose pipeline. `GIT_CONFIG_GLOBAL` isolation +
 * `isolatePiAgentDir` keep the developer's real config/sessions untouched.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-slicing-int-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/** Seed a `work/prd/<slug>.md` (committed onto the arbiter). */
function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'prd');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug} — slice me`,
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

/** An agent that writes one backlog slice file (no git). */
function slicingAgent(file = 'child'): SliceAgentRunner {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'backlog');
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
	it('integrates the slices + the PRD lifecycle move onto arbiter main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			today: '2026-06-08',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		// The produced slice + the PRD restore + the `sliced:` marker all landed on
		// the arbiter main, through the shared core (not the lock's direct commit).
		expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/prd/it.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/slicing/it.md')).toBe(false);
		const prd = run('git', ['show', `${ARBITER}/main:work/prd/it.md`], repo, {
			env: gitEnv(),
		}).stdout;
		expect(prd).toMatch(/sliced: 2026-06-08/);
		// It is the shared core's integrate commit (`slicing(<slug>): …; sliced`),
		// not the lock's `slicing: release …` direct commit.
		expect(arbiterHeadSubject(repo)).toMatch(/^slicing\(it\):/);
	});
});

describe('do prd: output through performIntegration — --propose opens a PR, main untouched', () => {
	it('pushes the work branch + opens a PR carrying the slices; does NOT touch main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');

		// A recording `gh` stub on PATH (no real GitHub), driven by provider: github.
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

		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'propose',
			provider: 'github',
			today: '2026-06-08',
			agentRunner: slicingAgent('child'),
			env: {...gitEnv(), PATH: `${binDir}:${process.env.PATH ?? ''}`},
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');

		// The slices are NOT on main (propose does not land them); the PRD is still
		// HELD in slicing/ on main (the lock release rides the PR, not main).
		expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/prd/it.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/slicing/it.md')).toBe(true);
		// The OUTPUT never advanced main past the lock's `prd → slicing/` move: the
		// main tip is the lock commit, NOT a slicing integrate commit.
		expect(arbiterHeadSubject(repo)).toMatch(/^slicing: lock it/);

		// The work branch was PUSHED carrying the slices + the PRD restore.
		expect(onArbiterBranch(repo, 'work/it', 'work/backlog/child.md')).toBe(
			true,
		);
		expect(onArbiterBranch(repo, 'work/it', 'work/prd/it.md')).toBe(true);

		// A PR was opened (the recording gh stub captured a `pr create`).
		const args = readFileSync(argsFile, 'utf8');
		expect(args).toMatch(/^create$/m);
		expect(args).toMatch(/^--title$/m);
		expect(args).toContain('slicing(it)');
	});
});

describe('do prd: arg parity with do slice: (the SAME integrate-time args resolve)', () => {
	// Arg PARITY by construction (AC #4): because `do prd:`'s output integrates
	// THROUGH the SAME `performIntegration` core `do slice:` uses, every
	// integrate-time arg resolves IDENTICALLY on both paths — there is no duplicated
	// parser. A table over the integrate-MODE flag (`propose`/`merge`) proves the
	// resolution: the SAME `integration` value produces the SAME observable
	// integrate effect on the slicing path it produces on the build path (no-main
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
			const result = await performSlice({
				slug: 'it',
				cwd: repo,
				arbiter: ARBITER,
				autoSlice: true,
				// The integrate-time arg — the SAME knob `do slice:`/`complete` thread into
				// `performIntegration.mode` — with NO slicing-specific parser.
				integration: row.mode,
				today: '2026-06-08',
				agentRunner: slicingAgent('child'),
				env: gitEnv(),
			});
			expect(result.outcome).toBe('sliced');
			// The shared core resolved the mode to the SAME effect it resolves for a
			// build: merge lands the slice on main; propose does not (it pushes the
			// `work/<slug>` branch + leaves main untouched, the PR source).
			expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(
				row.landsOnMain,
			);
			if (!row.landsOnMain) {
				// Propose pushed the work branch carrying the slices (the SAME branch
				// `performIntegration` integrates on the build path).
				expect(onArbiterBranch(repo, 'work/it', 'work/backlog/child.md')).toBe(
					true,
				);
			}
		});
	}
});
