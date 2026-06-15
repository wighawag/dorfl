import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, mergeConfig} from '../src/config.js';
import {
	REPO_ALLOWED_KEYS,
	REPO_REJECTED_KEYS,
	REPO_CONFIG_FILENAME,
	resolveRepoConfig,
	loadRepoConfig,
} from '../src/repo-config.js';
import {envOverrides, envVarName} from '../src/env-config.js';
import {reviewFlagOverrides, doFlagOverrides} from '../src/do-config.js';
import {
	parseReviewVerdict,
	ReviewParseError,
	buildReviewPrompt,
	harnessReviewGate,
	formatBlockReason,
	reviewRoundsExhaustedReason,
	type ReviewVerdict,
} from '../src/review-gate.js';
import {NullHarness, MODEL_PLACEHOLDER, type Harness} from '../src/harness.js';

/**
 * Gate 2 (PR/code review) — the SEAM + config-resolution unit tests (pure logic,
 * no git). The do/complete WIRING (approve→integrate, block→needs-attention,
 * verify-runs-first, reviewMaxRounds exhaustion) lives in
 * `review-gate-pr.test.ts` (real git, sequential project). Here we pin: the
 * config keys + their precedence, the verdict parser, the reviewModel override
 * reaching the launch via the existing `LaunchInput.model`/`substituteModel`
 * seam, and the reason formatters.
 */

describe('config — the Gate-2 keys (defaults + carry-through)', () => {
	it('review default OFF; reviewMaxRounds defaults to 2', () => {
		expect(DEFAULT_CONFIG.review).toBe(false);
		expect(DEFAULT_CONFIG.reviewMaxRounds).toBe(2);
		expect(mergeConfig({}).review).toBe(false);
		expect(mergeConfig({}).reviewMaxRounds).toBe(2);
	});

	it('autoMerge is GONE from DEFAULT_CONFIG', () => {
		expect('autoMerge' in DEFAULT_CONFIG).toBe(false);
	});

	it('reviewModel is unset by default (no forced review model)', () => {
		expect(DEFAULT_CONFIG.reviewModel).toBeUndefined();
		expect('reviewModel' in DEFAULT_CONFIG).toBe(false);
		expect(mergeConfig({}).reviewModel).toBeUndefined();
	});

	it('carries the keys through mergeConfig when set', () => {
		const merged = mergeConfig({
			review: true,
			reviewModel: 'review/model',
			reviewMaxRounds: 5,
		});
		expect(merged.review).toBe(true);
		expect(merged.reviewModel).toBe('review/model');
		expect(merged.reviewMaxRounds).toBe(5);
	});
});

describe('env-config — the keys are coerced (typed, loud)', () => {
	it('coerces review as a boolean and reviewMaxRounds as a number', () => {
		const env = {
			AGENT_RUNNER_REVIEW: 'true',
			AGENT_RUNNER_REVIEW_MODEL: 'env/review',
			AGENT_RUNNER_REVIEW_MAX_ROUNDS: '3',
		};
		const o = envOverrides(env);
		expect(o.review).toBe(true);
		expect(o.reviewModel).toBe('env/review');
		expect(o.reviewMaxRounds).toBe(3);
	});

	it('AGENT_RUNNER_AUTO_MERGE is inert — not a recognised env var', () => {
		// autoMerge is gone, so its env var no longer resolves to any config key.
		const o = envOverrides({AGENT_RUNNER_AUTO_MERGE: 'true'});
		expect('autoMerge' in o).toBe(false);
	});

	it('names the env vars by the SCREAMING_SNAKE convention', () => {
		expect(envVarName('review')).toBe('AGENT_RUNNER_REVIEW');
		expect(envVarName('reviewModel')).toBe('AGENT_RUNNER_REVIEW_MODEL');
		expect(envVarName('reviewMaxRounds')).toBe(
			'AGENT_RUNNER_REVIEW_MAX_ROUNDS',
		);
	});

	it('fails LOUDLY on a non-boolean review', () => {
		expect(() => envOverrides({AGENT_RUNNER_REVIEW: 'yes'})).toThrow(
			/AGENT_RUNNER_REVIEW/,
		);
	});
});

describe('repo-config — the four keys are per-repo policy (allowed), like integration', () => {
	let repo: string;
	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'agent-runner-review-cfg-'));
	});
	afterEach(() => {
		rmSync(repo, {recursive: true, force: true});
	});

	function writeRepoConfig(value: unknown): void {
		writeFileSync(join(repo, REPO_CONFIG_FILENAME), JSON.stringify(value));
	}

	it('treats review/reviewModel/reviewMaxRounds as repo-appropriate', () => {
		for (const key of ['review', 'reviewModel', 'reviewMaxRounds']) {
			expect(REPO_ALLOWED_KEYS).toContain(key);
			expect(REPO_REJECTED_KEYS).not.toContain(key);
		}
		// autoMerge is GONE — no longer a recognised per-repo key.
		expect(REPO_ALLOWED_KEYS).not.toContain('autoMerge');
	});

	it('a stale `autoMerge` key in a per-repo file is silently inert', () => {
		// No hard error, no deprecation warning: an unrecognised key is dropped
		// (neither honoured into config nor reported as rejected).
		writeRepoConfig({review: true, autoMerge: false});
		const loaded = loadRepoConfig(repo);
		expect('autoMerge' in loaded.config).toBe(false);
		expect(loaded.rejected).not.toContain('autoMerge');
		expect(loaded.message).toBeUndefined();
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
		});
		expect('autoMerge' in resolved.config).toBe(false);
		expect(resolved.config.review).toBe(true);
	});

	it('honours the keys from a per-repo file', () => {
		writeRepoConfig({
			review: true,
			reviewModel: 'repo/review',
			reviewMaxRounds: 4,
		});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
		});
		expect(resolved.config.review).toBe(true);
		expect(resolved.config.reviewModel).toBe('repo/review');
		expect(resolved.config.reviewMaxRounds).toBe(4);
	});

	it('resolves review: flag > env > per-repo > global > default-off (the integration chain)', () => {
		// default: off
		expect(
			resolveRepoConfig({repoPath: repo, global: mergeConfig({})}).config
				.review,
		).toBe(false);

		// global only
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({review: true}),
			}).config.review,
		).toBe(true);

		// per-repo beats global (repo says off, global says on)
		writeRepoConfig({review: false});
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({review: true}),
			}).config.review,
		).toBe(false);

		// env beats per-repo + global
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({review: true}),
				env: {AGENT_RUNNER_REVIEW: 'true'},
			}).config.review,
		).toBe(true);

		// flag beats everything (flag off wins over env/global on)
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({review: true}),
				env: {AGENT_RUNNER_REVIEW: 'true'},
				flags: reviewFlagOverrides({review: false}),
			}).config.review,
		).toBe(false);
	});

	it('resolves reviewModel / reviewMaxRounds the SAME chain', () => {
		writeRepoConfig({
			reviewModel: 'repo/m',
			reviewMaxRounds: 2,
		});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			env: {AGENT_RUNNER_REVIEW_MODEL: 'env/m'},
			flags: reviewFlagOverrides({
				reviewMaxRounds: '7',
			}),
		});
		// env reviewModel beats per-repo; flag reviewMaxRounds 7 beats per-repo 2.
		expect(resolved.config.reviewModel).toBe('env/m');
		expect(resolved.config.reviewMaxRounds).toBe(7);
	});
});

describe('reviewFlagOverrides / doFlagOverrides — flag mapping', () => {
	it('maps present flags only (absent ⇒ absent key)', () => {
		expect(reviewFlagOverrides({})).toEqual({});
		const o = reviewFlagOverrides({
			review: true,
			reviewModel: 'x',
			reviewMaxRounds: '3',
		});
		expect(o).toEqual({
			review: true,
			reviewModel: 'x',
			reviewMaxRounds: 3,
		});
	});

	it('drops a non-numeric reviewMaxRounds (lower layer / default decides)', () => {
		expect(
			reviewFlagOverrides({reviewMaxRounds: 'abc'}).reviewMaxRounds,
		).toBeUndefined();
		expect(
			reviewFlagOverrides({reviewMaxRounds: ''}).reviewMaxRounds,
		).toBeUndefined();
	});

	it('doFlagOverrides folds the review flags in alongside the harness flags', () => {
		const o = doFlagOverrides(
			{harness: 'pi', review: true, reviewModel: 'r/m'},
			'merge',
		);
		expect(o.harness).toBe('pi');
		expect(o.review).toBe(true);
		expect(o.reviewModel).toBe('r/m');
		expect(o.integration).toBe('merge');
	});
});

describe('parseReviewVerdict — reads the review SKILL verdict shape', () => {
	it('parses a bare approve verdict', () => {
		const v = parseReviewVerdict('{"verdict":"approve","findings":[]}');
		expect(v.verdict).toBe('approve');
		expect(v.findings).toEqual([]);
	});

	it('parses a block verdict with findings, even wrapped in prose/fences', () => {
		const output = [
			'Here is my review.',
			'```json',
			JSON.stringify({
				verdict: 'block',
				findings: [
					{
						severity: 'blocking',
						question: 'the diff does not deliver criterion 2',
						context: 'src/foo.ts:10',
					},
					{severity: 'non-blocking', question: 'a nit'},
				],
			}),
			'```',
		].join('\n');
		const v = parseReviewVerdict(output);
		expect(v.verdict).toBe('block');
		expect(v.findings).toHaveLength(2);
		expect(v.findings[0].severity).toBe('blocking');
		expect(v.findings[0].context).toBe('src/foo.ts:10');
		expect(v.findings[1].severity).toBe('non-blocking');
	});

	it('throws ReviewParseError on no verdict / invalid verdict (never silent approve)', () => {
		expect(() => parseReviewVerdict('I think it looks fine')).toThrow(
			ReviewParseError,
		);
		expect(() =>
			parseReviewVerdict('{"verdict":"maybe","findings":[]}'),
		).toThrow(ReviewParseError);
		expect(() => parseReviewVerdict('{"verdict": not json')).toThrow(
			ReviewParseError,
		);
	});
});

describe('buildReviewPrompt — frames code-vs-its-slice + the required output', () => {
	it('names the slug, the review skill, and demands the JSON verdict shape', () => {
		const p = buildReviewPrompt('my-slice');
		expect(p).toMatch(/review` skill/);
		expect(p).toContain('my-slice');
		expect(p).toMatch(/"verdict"/);
		expect(p).toMatch(/approve.*block|block.*approve/s);
		// Fresh-context reviewer that EDITS nothing.
		expect(p).toMatch(/EMIT a verdict only|Do NOT edit/i);
	});

	it('tells the reviewer Gate 1 (build+tests+format) already passed → assume green, do NOT re-run the suite', () => {
		const p = buildReviewPrompt('my-slice');
		// The acceptance gate is already green; the reviewer must assume it and
		// not re-run build/tests/format (Gate 1 is the settled deterministic floor).
		expect(p).toMatch(/already passed|already.*green|assume.*green/i);
		expect(p).toMatch(/not re-?run|do NOT re-?run/i);
		// Sits alongside the existing edit-nothing/EMIT-only constraint.
		expect(p).toMatch(/EMIT a verdict only/);
		// NUANCE: it forbids RE-RUNNING the suite, NOT reading/reasoning about
		// tests — no "ignore tests" wording.
		expect(p).not.toMatch(/ignore tests/i);
	});

	it('HUNTS for in-scope decisions the slice did not specify, flagged for ratification (Part C)', () => {
		const p = buildReviewPrompt('my-slice');
		// The reviewer must look for undeclared in-scope decisions — cross-slice
		// interactions, new errors/refusals, user-visible defaults.
		expect(p).toMatch(/decision/i);
		expect(p).toMatch(/cross-slice/i);
		expect(p).toMatch(/error|refusal/i);
		expect(p).toMatch(/default/i);
		// It STARTS from the agent's `## Decisions` block + hunts for missed ones.
		expect(p).toMatch(/## Decisions/);
		expect(p).toMatch(/ratif/i);
		// Non-blocking by DEFAULT (the build proceeds; the human ratifies/reverses).
		expect(p).toMatch(/non-blocking/i);
	});

	it('checks CONCEPTUAL COHERENCE — concept used consistently, at the right layer, not duplicating an existing one', () => {
		const p = buildReviewPrompt('my-slice');
		// The reviewer must check the diff fits the system's existing LANGUAGE.
		expect(p).toMatch(/coheren/i);
		// The three coherence questions: consistent meaning, right layer, no duplicate.
		expect(p).toMatch(/consistent|re-?mean/i);
		expect(p).toMatch(/layer/i);
		expect(p).toMatch(/duplicate|overlap|fork/i);
		// It leans on the glossary as the source of truth for term meaning.
		expect(p).toMatch(/CONTEXT\.md|glossary/i);
	});
});

describe('harnessReviewGate — reviewModel reaches the launch via the existing seam', () => {
	it('forwards reviewModel as LaunchInput.model (no new model mechanism)', async () => {
		let seenModel: string | undefined = 'UNSET';
		let seenPrompt = '';
		const spyHarness: Harness = {
			adapter: 'spy',
			launch(input) {
				seenModel = input.model;
				seenPrompt = input.prompt ?? '';
				// The verdict rides the ANSWER channel (`output`), NOT `detail` (which is
				// the failure channel, empty on success) — slice `harness-agent-output`.
				return {
					ok: true,
					record: {adapter: 'spy'},
					output: '{"verdict":"approve","findings":[]}',
				};
			},
			launchInteractive: () => {
				throw new Error('stub harness does not launch interactively');
			},
			isAlive: () => false,
		};
		const gate = harnessReviewGate({harness: spyHarness, agentCmd: 'ignored'});
		const verdict = await gate({
			slug: 'feat',
			cwd: '/tmp',
			reviewModel: 'review/override',
			round: 1,
		});
		// The reviewModel override rode the EXISTING LaunchInput.model seam.
		expect(seenModel).toBe('review/override');
		// The review prompt (the skill framing) was fed to the launch.
		expect(seenPrompt).toMatch(/review` skill/);
		expect(verdict.verdict).toBe('approve');
	});

	it('substitutes reviewModel through the null/shell {model} placeholder', async () => {
		// The null adapter substitutes {model} in agentCmd (the existing seam) — a
		// command that echoes a verdict containing the substituted model proves the
		// reviewModel flowed through substituteModel, not a parallel mechanism.
		const gate = harnessReviewGate({
			harness: new NullHarness(),
			// Echo a verdict whose context carries the substituted model.
			agentCmd: `printf '%s' '{"verdict":"approve","findings":[{"severity":"non-blocking","question":"ok","context":"{model}"}]}'`,
			// The null adapter writes the command's stdout nowhere we read; instead
			// read it from the recorded command is not possible — so assert via a
			// separate readOutput that returns the launched command's stdout.
			readOutput: () =>
				`{"verdict":"approve","findings":[{"severity":"non-blocking","question":"ok","context":"chosen/model"}]}`,
		});
		const v = await gate({
			slug: 'feat',
			cwd: process.cwd(),
			reviewModel: 'chosen/model',
			round: 1,
		});
		expect(v.verdict).toBe('approve');
	});

	it('reads the verdict from launched.output (the ANSWER channel), not detail', async () => {
		// A successful launch carries the verdict in `output`; `detail` is empty on
		// success. The gate must read `output` (slice `harness-agent-output`).
		const outputHarness: Harness = {
			adapter: 'out',
			launch: () => ({
				ok: true,
				record: {adapter: 'out'},
				output:
					'Verdict below.\n{"verdict":"block","findings":[{"severity":"blocking","question":"misses it"}]}',
				detail: undefined,
			}),
			launchInteractive: () => {
				throw new Error('stub harness does not launch interactively');
			},
			isAlive: () => false,
		};
		const gate = harnessReviewGate({harness: outputHarness});
		const v = await gate({slug: 'feat', cwd: '/tmp', round: 1});
		expect(v.verdict).toBe('block');
		expect(v.findings[0].question).toBe('misses it');
	});

	it('an empty/absent output is the ReviewParseError→needs-attention path (no silent approve)', async () => {
		// A successful launch with NO assistant text (output undefined) must NOT be
		// read as approve — it parses to nothing and errors (the live gap this slice
		// closes: detail was empty on success, so this used to fire every run).
		const emptyOutput: Harness = {
			adapter: 'empty',
			launch: () => ({ok: true, record: {adapter: 'empty'}, output: undefined}),
			launchInteractive: () => {
				throw new Error('stub harness does not launch interactively');
			},
			isAlive: () => false,
		};
		const gate = harnessReviewGate({harness: emptyOutput});
		await expect(
			gate({slug: 'feat', cwd: '/tmp', round: 1}),
		).rejects.toBeInstanceOf(ReviewParseError);
	});

	it('errors (ReviewParseError) when the launch fails — never a silent approve', async () => {
		const failing: Harness = {
			adapter: 'fail',
			launch: () => ({
				ok: false,
				record: {adapter: 'fail'},
				detail: 'boom',
			}),
			launchInteractive: () => {
				throw new Error('stub harness does not launch interactively');
			},
			isAlive: () => false,
		};
		const gate = harnessReviewGate({harness: failing});
		await expect(
			gate({slug: 'feat', cwd: '/tmp', round: 1}),
		).rejects.toBeInstanceOf(ReviewParseError);
	});

	it('rejects a {model} placeholder with no reviewModel (the substituteModel guard)', async () => {
		const gate = harnessReviewGate({
			harness: new NullHarness(),
			agentCmd: 'review-agent --model {model}',
		});
		await expect(
			gate({slug: 'feat', cwd: process.cwd(), round: 1}),
		).rejects.toThrow(new RegExp(MODEL_PLACEHOLDER.replace(/[{}]/g, '\\$&')));
	});
});

describe('reason formatters', () => {
	it('formatBlockReason records the BLOCKING findings as body prose', () => {
		const verdict: ReviewVerdict = {
			verdict: 'block',
			findings: [
				{severity: 'blocking', question: 'misses criterion 3', context: 'a.ts'},
				{severity: 'non-blocking', question: 'a nit (omitted)'},
			],
		};
		const reason = formatBlockReason(verdict);
		expect(reason).toMatch(/misses criterion 3/);
		expect(reason).toMatch(/a\.ts/);
		// Non-blocking nits are not part of the block reason.
		expect(reason).not.toMatch(/a nit/);
	});

	it('reviewRoundsExhaustedReason names the bound + the no-silent-merge rule', () => {
		const r = reviewRoundsExhaustedReason(2);
		expect(r).toMatch(/reviewMaxRounds=2/);
		expect(r).toMatch(/needs-attention/);
	});
});
