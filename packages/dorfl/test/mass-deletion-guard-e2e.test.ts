import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {chmodSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performDo, type DoDorfl} from '../src/do.js';
import {runOnce, type Dorfl} from '../src/run.js';
import {GitHubProvider} from '../src/github.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import {MASS_DELETION_NOTE_HEADING} from '../src/mass-deletion-guard.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * The mass-deletion guard end to end (ADR
 * `mass-deletion-guard-asks-the-agent-once-then-tells-the-reviewer`): a build
 * agent that guts a pre-existing `CONTEXT.md` is handed ONE follow-up turn
 * before the gate, and whatever is still gutted lands in the PR body. Real git
 * against a `--bare` arbiter that writes main, so this file runs in the
 * sequential vitest project.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-mass-deletion-e2e-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const CONTEXT = Array.from({length: 780}, (_, i) => `context ${i + 1}`).join(
	'\n',
);

/** Seed a repo whose main carries a 780-line CONTEXT.md. */
function seed(): string {
	const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
	writeFileSync(join(repo, 'CONTEXT.md'), CONTEXT + '\n');
	gitIn(['add', 'CONTEXT.md'], repo);
	gitIn(['commit', '-q', '-m', 'add CONTEXT.md'], repo);
	gitIn(['push', '-q', ARBITER, 'main'], repo);
	gitIn(['fetch', '-q', ARBITER], repo);
	return repo;
}

/** Truncate CONTEXT.md mid-sentence, the way the incident did. */
function gut(cwd: string): void {
	writeFileSync(
		join(cwd, 'CONTEXT.md'),
		CONTEXT.split('\n').slice(0, 467).join('\n') +
			'\n... conversationSearch.au',
	);
}

/** A recording `gh` stub that opens a fake PR and keeps its argv. */
function recordingGh(): {bin: string; readArgs(): string} {
	const dir = join(scratch.root, 'gh-stub');
	mkdirSync(dir, {recursive: true});
	const argsFile = join(dir, 'gh-args.txt');
	const bin = join(dir, 'gh');
	writeFileSync(
		bin,
		[
			'#!/usr/bin/env bash',
			`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
			"printf '%s\\n' 'https://github.com/o/r/pull/7'",
			'exit 0',
		].join('\n') + '\n',
	);
	chmodSync(bin, 0o755);
	return {bin, readArgs: () => readFileSync(argsFile, 'utf8')};
}

describe('do: the mass-deletion guard', () => {
	it('a gutted file the agent RESTORES on the follow-up opens a clean PR', async () => {
		const repo = seed();
		const gh = recordingGh();
		const prompts: string[] = [];
		const agent: DoDorfl = ({cwd, prompt}) => {
			prompts.push(prompt);
			if (prompts.length === 1) {
				gut(cwd);
				writeFileSync(join(cwd, 'feature.ts'), 'export {};\n');
				return {ok: true, output: 'Built alpha.'};
			}
			writeFileSync(join(cwd, 'CONTEXT.md'), CONTEXT + '\nnew line\n');
			return {ok: true, output: 'Restored CONTEXT.md.'};
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh.bin}),
			verify: 'exit 0',
			dorfl: agent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain('`CONTEXT.md`');
		expect(prompts[1]).toContain('of its 780 lines removed');
		const args = gh.readArgs();
		expect(args).toContain('Built alpha.');
		expect(args).not.toContain(MASS_DELETION_NOTE_HEADING);
		expect(args).not.toContain('Restored CONTEXT.md.');
	});

	it('a gutted file the agent KEEPS is flagged in the PR body', async () => {
		const repo = seed();
		const gh = recordingGh();
		let calls = 0;
		const agent: DoDorfl = ({cwd}) => {
			calls++;
			if (calls === 1) {
				gut(cwd);
				return {ok: true, output: 'Built alpha.'};
			}
			return {ok: true, output: 'CONTEXT.md: the task asked for this.'};
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh.bin}),
			verify: 'exit 0',
			dorfl: agent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(calls).toBe(2);
		const args = gh.readArgs();
		expect(args).toContain('Built alpha.');
		expect(args).toContain(MASS_DELETION_NOTE_HEADING);
		expect(args).toContain(
			'`CONTEXT.md`: 312 of its 780 lines removed (+1 -313)',
		);
	});

	it('massDeletionGuard off: no follow-up turn, no note', async () => {
		const repo = seed();
		const gh = recordingGh();
		let calls = 0;
		const agent: DoDorfl = ({cwd}) => {
			calls++;
			gut(cwd);
			return {ok: true, output: 'Built alpha.'};
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh.bin}),
			verify: 'exit 0',
			dorfl: agent,
			massDeletionGuard: {enabled: false, lines: 150, ratio: 0.4},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(calls).toBe(1);
		expect(gh.readArgs()).not.toContain(MASS_DELETION_NOTE_HEADING);
	});
});

describe('do: a task that opts out with `massDeletionGuard: false`', () => {
	it('builds a planned split refactor with no follow-up turn and no note', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		writeFileSync(join(repo, 'CONTEXT.md'), CONTEXT + '\n');
		// The task itself declares the opt-out.
		const taskPath = join(repo, 'work', 'tasks', 'ready', 'alpha.md');
		writeFileSync(
			taskPath,
			readFileSync(taskPath, 'utf8').replace(
				'blockedBy: []',
				'massDeletionGuard: false\nblockedBy: []',
			),
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'add CONTEXT.md + opt out'], repo);
		gitIn(['push', '-q', ARBITER, 'main'], repo);
		gitIn(['fetch', '-q', ARBITER], repo);
		const gh = recordingGh();
		let calls = 0;
		const agent: DoDorfl = ({cwd}) => {
			calls++;
			// Split CONTEXT.md: most of it moves into a new file.
			const all = CONTEXT.split('\n');
			writeFileSync(
				join(cwd, 'CONTEXT.md'),
				all.slice(0, 100).join('\n') + '\n',
			);
			writeFileSync(
				join(cwd, 'CONTEXT-2.md'),
				all.slice(100).join('\n') + '\n',
			);
			return {ok: true, output: 'Split CONTEXT.md.'};
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh.bin}),
			verify: 'exit 0',
			dorfl: agent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(calls).toBe(1);
		expect(gh.readArgs()).not.toContain(MASS_DELETION_NOTE_HEADING);
	});
});

describe('run: the mass-deletion guard', () => {
	it('hands a gutted file back to the agent once before the gate', async () => {
		const repo = seed();
		const prompts: string[] = [];
		const agent: Dorfl = ({cwd, prompt}) => {
			prompts.push(prompt);
			if (prompts.length === 1) {
				gut(cwd);
				writeFileSync(join(cwd, 'feature.ts'), 'export {};\n');
			} else {
				writeFileSync(join(cwd, 'CONTEXT.md'), CONTEXT + '\n');
			}
			return {ok: true};
		};
		const config = mergeConfig({
			defaultArbiter: ARBITER,
			maxParallel: 1,
			perRepoMax: 1,
			integration: 'merge',
			agentCmd: 'true',
			verify: 'exit 0',
			autoBuild: true,
		});
		const result = await runOnce({
			config,
			report: scanRepoPaths([repo], config),
			workspace: join(scratch.root, 'ws'),
			dorfl: agent,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('claimed-done');
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain('`CONTEXT.md`');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		// The restored file is what landed.
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(['show', `${ARBITER}/main:CONTEXT.md`], repo).split('\n').length,
		).toBeGreaterThanOrEqual(780);
	});
});
