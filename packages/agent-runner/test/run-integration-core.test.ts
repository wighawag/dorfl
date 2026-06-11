import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync, mkdirSync, chmodSync, readFileSync} from 'node:fs';
import {runOnce, type AgentRunner} from '../src/run.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import type {ReviewGate, ReviewVerdict} from '../src/review-gate.js';
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
 * `run` routed through the SHARED `performIntegration` core (the run/do
 * convergence — `work/prd/run-do-integrate-convergence.md`, Slice 2). These are
 * the FOUR acceptance proofs the fleet now inherits from the converged back-half
 * (which it forked, and so LACKED, before): the review gate (Gate 2), the PR
 * title + body, and the per-repo language-agnostic `verify` gate — PLUS the
 * thrown-core-error guard.
 *
 * House style (mirrors `review-gate-pr.test.ts` / `run.test.ts`): a throwaway
 * working checkout + a local `--bare` arbiter + a STUBBED agent (edits files
 * directly) + a STUBBED review gate (a canned approve/block verdict — NO real
 * model). `isolatePiAgentDir` + the do/run machinery keep the real
 * `~/.agent-runner/` + `~/.pi/agent/sessions/` untouched (no real launch runs;
 * all writes go to temp work trees / scratch arbiters).
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-run-core-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const PASS = 'exit 0';
const FAIL = 'exit 1';

/** A stubbed agent that edits a file (non-empty commit) and succeeds. */
const editingAgent: AgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

/** A stubbed review gate returning a fixed verdict (mirrors the do tests). */
type StubGate = ReviewGate & {readonly calls: number};
function stubGate(verdict: ReviewVerdict): StubGate {
	let calls = 0;
	const gate = (async () => {
		calls++;
		return verdict;
	}) as StubGate;
	Object.defineProperty(gate, 'calls', {get: () => calls});
	return gate;
}

const APPROVE: ReviewVerdict = {verdict: 'approve', findings: []};
const BLOCK: ReviewVerdict = {
	verdict: 'block',
	findings: [
		{
			severity: 'blocking',
			question: 'the diff does not reach the slice goal',
			context: 'agent-output.txt',
		},
	],
};

function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
	return scanRepoPaths([join(scratch.root, 'project')], config);
}

function configFor(overrides = {}) {
	return mergeConfig({
		defaultArbiter: 'arbiter',
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		verify: PASS,
		allowAgents: true,
		...overrides,
	});
}

describe('run through performIntegration — review-gated (Gate 2)', () => {
	it('review on + a BLOCK verdict routes a run item to needs-attention and does NOT integrate', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		// reviewMaxRounds=1 so a persistent block is invoked exactly once (a single
		// block IS exhaustion at maxRounds=1) — proving the route without the loop.
		const config = configFor({review: true, reviewMaxRounds: 1});
		const gate = stubGate(BLOCK);
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			reviewGate: gate,
			env: gitEnv(),
		});

		// A blocked review routes to needs-attention (the SAME mapping a red gate /
		// rebase conflict uses) — the fleet now gets Gate 2 it previously lacked.
		expect(gate.calls).toBe(1);
		expect(result.items[0].status).toBe('needs-attention');
		expect(result.claimedAndDone).toBe(0);
		// NOT integrated: never reached done on main; surfaced as needs-attention.
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'feat')).toBe(true);
	});

	it('review on + an APPROVE verdict integrates normally (the gate ran, did not block)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor({review: true, autoMerge: true});
		const gate = stubGate(APPROVE);
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			reviewGate: gate,
			env: gitEnv(),
		});
		expect(gate.calls).toBe(1);
		expect(result.items[0].status).toBe('claimed-done');
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
	});
});

describe('run through performIntegration — propose PR title + body', () => {
	/**
	 * The fleet's propose PRs now carry the SAME synthesised single-line `--title`
	 * + agent-summary `--body` that `do`'s do (PR #15's fix, previously only on the
	 * `do` path). A recording `gh` stub on PATH (no real GitHub) + `provider:
	 * 'github'` drives the real propose pipeline; the stub records the `gh` args.
	 */
	it('passes a synthesised --title + a --body (from the agent output); never --fill', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		void repo;
		const binDir = join(scratch.root, 'gh-stub-run');
		mkdirSync(binDir, {recursive: true});
		const argsFile = join(binDir, 'gh-args.txt');
		const gh = join(binDir, 'gh');
		writeFileSync(
			gh,
			[
				'#!/usr/bin/env bash',
				`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
				"printf '%s\\n' 'https://github.com/o/r/pull/42'",
				'exit 0',
			].join('\n') + '\n',
		);
		chmodSync(gh, 0o755);

		// The build agent SUPPLIES a final summary on `output` (the PR-body source).
		const summarisingAgent: AgentRunner = ({cwd}) => {
			writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
			return {
				ok: true,
				output: 'Implemented feat. Note: routed run through the core.',
			};
		};

		const config = configFor({integration: 'propose', provider: 'github'});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: summarisingAgent,
			env: {...gitEnv(), PATH: `${binDir}:${process.env.PATH ?? ''}`},
		});
		expect(result.items[0].status).toBe('claimed-done');

		const args = readFileSync(argsFile, 'utf8');
		// A synthesised single-line title (never the run-on --fill derives).
		expect(args).toMatch(/^--title$/m);
		expect(args).toContain('feat(feat)');
		// The agent's surfaced output reaches the PR body, under the slice pointer.
		expect(args).toMatch(/^--body$/m);
		expect(args).toContain(
			'Implemented feat. Note: routed run through the core.',
		);
		expect(args).toContain('work/done/feat.md');
		// Title + body present ⇒ gh never re-derives from the commit subject.
		expect(args).not.toMatch(/^--fill$/m);
	});
});

describe('run through performIntegration — per-repo, language-agnostic gate', () => {
	it('runs a CUSTOM `verify` command (NOT a hardcoded pnpm -r test)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		void repo;
		// A custom verify that PROVES it ran by writing a marker — and that the
		// deleted `defaultTestGate`'s `pnpm -r test` is NOT what runs.
		const marker = join(scratch.root, 'verify-ran.marker');
		const config = configFor({
			verify: `touch ${JSON.stringify(marker)}`,
		});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('claimed-done');
		// The per-repo command ran in the job worktree (the marker exists).
		expect(readFileSync(marker, 'utf8')).toBe('');
	});

	it('a format-only failure (build+test green, format red) routes a run item to needs-attention', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		// The FULL floor, not test-only: build + test pass, format fails. The old
		// `defaultTestGate` (test-only `pnpm -r test`) would have passed this — the
		// per-repo `verify` floor catches it.
		const config = configFor({
			verify: ['exit 0', 'exit 0', 'exit 1'],
		});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('tests-failed');
		expect(result.claimedAndDone).toBe(0);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'feat')).toBe(true);
	});
});

describe('run through performIntegration — a THROWN core error is caught', () => {
	it('review on with NO reviewGate (the core throws) is routed as config-error, the worktree handled, the run continues', async () => {
		// `performIntegration` THROWS a plain Error when `review` is on but no
		// `reviewGate` is wired (a misconfiguration). `run`'s tail has no catch-all,
		// so `runOneItem` MUST wrap the call so the throw becomes a saved/needs-
		// attention ItemResult, never an uncaught crash of the tick. Two items prove
		// the run CONTINUES past the throwing one.
		seedRepoWithArbiter(scratch.root, ['feat', 'other']);
		const config = configFor({review: true});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			// review: true but reviewGate UNSET ⇒ the core throws for each item.
			env: gitEnv(),
		});
		// Both items were processed (the run did not crash on the first throw)…
		expect(result.items).toHaveLength(2);
		// …and each thrown core WIRING error is now classified `config-error` (the
		// FAILURE-CAUSE axis), NOT the undifferentiated `agent-failed` — a wiring bug
		// reads as a wiring bug, not as the agent misbehaving. (It still reuses the
		// work-preserving needs-attention seam; never an uncaught crash.)
		for (const item of result.items) {
			expect(item.status).toBe('config-error');
		}
		// The work was surfaced (not silently dropped): each item is in
		// needs-attention on main, and its branch was pushed.
		expect(
			existsOnArbiterMain(scratch.root + '/project', 'needs-attention', 'feat'),
		).toBe(true);
		gitIn(['fetch', '-q', 'arbiter'], join(scratch.root, 'project'));
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/slice-feat'],
				join(scratch.root, 'project'),
			).trim(),
		).not.toBe('');
	});
});
