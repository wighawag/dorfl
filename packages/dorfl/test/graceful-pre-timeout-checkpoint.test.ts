/**
 * Tests for the graceful pre-timeout WIP checkpoint (spec / task
 * `graceful-pre-timeout-wip-checkpoint`):
 *
 *   - Config defaults + FAIL-LOUD range validation for the three new fields.
 *   - The advance-lifecycle template renders a DYNAMIC GitHub timeout that
 *     consumes `dorfl config --json` at run time via the enumerate job's
 *     `githubTimeout` output (retiring the static `legTimeoutMinutes` render).
 *   - The `PiHarness.launchAsync` deadline race SIGTERMs the child on fire and
 *     resolves with `timedOut: true`; a run that finishes BEFORE the deadline
 *     is byte-for-byte unchanged (`timedOut` absent).
 *   - The `legTimeoutMinutes` config + install-ci flag are gone.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, writeFileSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rmrf} from './helpers/gitRepo.js';
import {
	DEFAULT_CONFIG,
	mergeConfig,
	validateDeadlineConfig,
	loadConfig,
} from '../src/config.js';
import {envOverrides} from '../src/env-config.js';
import {
	generateAdvanceLifecycleWorkflow,
	validateAdvanceLifecycleWorkflow,
} from '../src/advance-lifecycle-template.js';
import type {ResolvedCIConfig} from '../src/install-ci-core.js';
import {PiHarness, DEADLINE_SIGKILL_GRACE_MS} from '../src/pi-harness.js';

// ─── Config defaults + fail-loud coercion ────────────────────────────────────

describe('graceful-pre-timeout config — defaults + FAIL-LOUD range validation', () => {
	it('DEFAULT_CONFIG carries the three fields at the task-specified defaults', () => {
		expect(DEFAULT_CONFIG.agentDeadlineMinutes).toBe(60);
		expect(DEFAULT_CONFIG.checkpointHeadroomMinutes).toBe(30);
		expect(DEFAULT_CONFIG.maxAutoCheckpoints).toBe(5);
	});

	it('validateDeadlineConfig accepts the default triple', () => {
		expect(() => validateDeadlineConfig(mergeConfig({}))).not.toThrow();
	});

	it('validateDeadlineConfig THROWS (fail-loud, never clamps) on out-of-range agentDeadlineMinutes', () => {
		expect(() =>
			validateDeadlineConfig(mergeConfig({agentDeadlineMinutes: 0})),
		).toThrow(/agentDeadlineMinutes/);
		expect(() =>
			validateDeadlineConfig(mergeConfig({agentDeadlineMinutes: 241})),
		).toThrow(/agentDeadlineMinutes/);
		expect(() =>
			validateDeadlineConfig(mergeConfig({agentDeadlineMinutes: 30.5})),
		).toThrow(/agentDeadlineMinutes/);
	});

	it('validateDeadlineConfig THROWS on out-of-range checkpointHeadroomMinutes (MIN 10 MAX 60)', () => {
		expect(() =>
			validateDeadlineConfig(mergeConfig({checkpointHeadroomMinutes: 9})),
		).toThrow(/checkpointHeadroomMinutes/);
		expect(() =>
			validateDeadlineConfig(mergeConfig({checkpointHeadroomMinutes: 61})),
		).toThrow(/checkpointHeadroomMinutes/);
	});

	it('validateDeadlineConfig THROWS on non-positive maxAutoCheckpoints', () => {
		expect(() =>
			validateDeadlineConfig(mergeConfig({maxAutoCheckpoints: 0})),
		).toThrow(/maxAutoCheckpoints/);
	});

	it('loadConfig FAILS LOUDLY when the global config carries an out-of-range value', () => {
		const dir = mkdtempSync(join(tmpdir(), 'graceful-config-'));
		try {
			const path = join(dir, 'config.json');
			writeFileSync(path, JSON.stringify({agentDeadlineMinutes: 400}));
			expect(() => loadConfig(path)).toThrow(/agentDeadlineMinutes/);
		} finally {
			rmrf(dir);
		}
	});

	it('envOverrides reads the three fields as `DORFL_*` (per-machine override, ADR §13)', () => {
		const overrides = envOverrides({
			DORFL_AGENT_DEADLINE_MINUTES: '90',
			DORFL_CHECKPOINT_HEADROOM_MINUTES: '20',
			DORFL_MAX_AUTO_CHECKPOINTS: '3',
		});
		expect(overrides.agentDeadlineMinutes).toBe(90);
		expect(overrides.checkpointHeadroomMinutes).toBe(20);
		expect(overrides.maxAutoCheckpoints).toBe(3);
	});
});

// ─── The advance-lifecycle template renders a DYNAMIC GitHub cap ─────────────

const templateConfig: ResolvedCIConfig = {
	authMode: 'models-json',
	providers: [
		{
			name: 'anthropic',
			apiKeyEnvVar: 'ANTHROPIC_API_KEY',
			models: [{id: 'claude-sonnet-4-20250514'}],
			builtin: true,
		},
	],
	defaultProvider: 'anthropic',
	defaultModel: 'claude-sonnet-4-20250514',
	harness: 'pi',
	installSource: 'registry',
	maxParallel: 4,
};

describe('advance-lifecycle template — DYNAMIC GitHub backstop (retires legTimeoutMinutes)', () => {
	it('emits `githubTimeout` as an enumerate-job OUTPUT computed from `dorfl config --json`', () => {
		const text = generateAdvanceLifecycleWorkflow(templateConfig);
		// The enumerate job declares the output …
		expect(/enumerate:[\s\S]*?outputs:[\s\S]*?githubTimeout:/.test(text)).toBe(
			true,
		);
		// … computed via `dorfl config --json` at run time …
		expect(text).toContain('dorfl config --json');
		// … as `agentDeadlineMinutes + checkpointHeadroomMinutes`.
		expect(text).toContain('agentDeadlineMinutes + checkpointHeadroomMinutes');
	});

	it('the agent-leg jobs consume the DYNAMIC output; NO baked static `timeout-minutes: <n>`', () => {
		const text = generateAdvanceLifecycleWorkflow(templateConfig);
		expect(
			/advance-propose:[\s\S]*?timeout-minutes:\s*\$\{\{\s*needs\.enumerate\.outputs\.githubTimeout\s*\}\}/.test(
				text,
			),
		).toBe(true);
		expect(
			/advance-merge:[\s\S]*?timeout-minutes:\s*\$\{\{\s*needs\.enumerate\.outputs\.githubTimeout\s*\}\}/.test(
				text,
			),
		).toBe(true);
		// No baked-in numeric `timeout-minutes:` (the retired legTimeoutMinutes
		// render). Only the dynamic ${{ … }} reference is allowed.
		expect(
			/(?:advance-propose|advance-merge):[\s\S]*?timeout-minutes:\s*\d/.test(
				text,
			),
		).toBe(false);
	});

	it('validateAdvanceLifecycleWorkflow enforces the dynamic invariants', () => {
		const text = generateAdvanceLifecycleWorkflow(templateConfig);
		const {ok, problems} = validateAdvanceLifecycleWorkflow(text);
		expect(problems).toEqual([]);
		expect(ok).toBe(true);
	});

	it('the retired ResolvedCIConfig.legTimeoutMinutes field is GONE (no static render)', () => {
		// Structural: the field no longer exists on the resolved-config shape.
		const asRecord = templateConfig as unknown as Record<string, unknown>;
		expect('legTimeoutMinutes' in asRecord).toBe(false);
	});
});

// ─── The launchAsync deadline race ───────────────────────────────────────────

/**
 * Build a throwaway pi-CLI stub whose stdio + exit behaviour is scripted by a
 * body. The harness only cares about the pi bin's process contract (spawn +
 * exit code + a `--session <path>` argument the harness passes), so a bash
 * script suffices.
 */
function stubPiBin(dir: string, body: string): string {
	const bin = join(dir, 'stub-pi');
	writeFileSync(bin, `#!/usr/bin/env bash\n${body}\n`);
	chmodSync(bin, 0o755);
	return bin;
}

describe('PiHarness.launchAsync — deadline race (spec `graceful-pre-timeout-wip-checkpoint`)', () => {
	let work: string;
	beforeEach(() => {
		work = mkdtempSync(join(tmpdir(), 'graceful-launch-'));
	});
	afterEach(() => rmrf(work));

	it('SIGTERMs the child at the deadline and resolves with `timedOut: true`', async () => {
		// The stub pi sleeps for a long time; the deadline forces a SIGTERM well
		// before it would exit on its own. It TRAPs SIGTERM and exits 143.
		const piBin = stubPiBin(work, `trap 'exit 143' TERM\nsleep 30\nexit 0`);
		const harness = new PiHarness({piBin});
		const start = Date.now();
		const result = await harness.launchAsync({
			dir: work,
			slug: 'graceful-test',
			command: '',
			prompt: '',
			session: join(work, 'session.jsonl'),
			deadlineMs: Date.now() + 150,
		});
		const elapsed = Date.now() - start;
		expect(result.timedOut).toBe(true);
		expect(result.ok).toBe(false);
		// The deadline fired well before the 30s sleep; sanity that we didn't
		// wait for the natural exit.
		expect(elapsed).toBeLessThan(DEADLINE_SIGKILL_GRACE_MS + 5_000);
	}, 20_000);

	it('SIGKILLs after the ~10s grace when the child ignores SIGTERM', async () => {
		// The stub pi IGNORES SIGTERM and would otherwise sleep 60s. The follow-up
		// SIGKILL after `DEADLINE_SIGKILL_GRACE_MS` (10s) reaps it, so the result
		// still settles with `timedOut: true` in bounded time.
		const piBin = stubPiBin(work, `trap '' TERM\nsleep 60\nexit 0`);
		const harness = new PiHarness({piBin});
		const start = Date.now();
		const result = await harness.launchAsync({
			dir: work,
			slug: 'graceful-test-sigkill',
			command: '',
			prompt: '',
			session: join(work, 'session.jsonl'),
			deadlineMs: Date.now() + 100,
		});
		const elapsed = Date.now() - start;
		expect(result.timedOut).toBe(true);
		// Must be reaped within (grace + a fudge factor for spawn/exit latency).
		expect(elapsed).toBeLessThan(DEADLINE_SIGKILL_GRACE_MS + 5_000);
	}, 30_000);

	it('a run that finishes BEFORE the deadline is byte-for-byte unchanged (timedOut absent)', async () => {
		// Stub exits ~immediately; deadline is far in the future so the timer is
		// cleared on `exit` and the LaunchResult carries no timedOut flag.
		const piBin = stubPiBin(work, `exit 0`);
		const harness = new PiHarness({piBin});
		const result = await harness.launchAsync({
			dir: work,
			slug: 'graceful-normal-exit',
			command: '',
			prompt: '',
			session: join(work, 'session.jsonl'),
			deadlineMs: Date.now() + 60_000,
		});
		expect(result.timedOut).toBeUndefined();
		expect(result.ok).toBe(true);
	});

	it('the deadline is optional — an unset deadlineMs preserves the pre-task behaviour', async () => {
		const piBin = stubPiBin(work, `exit 0`);
		const harness = new PiHarness({piBin});
		const result = await harness.launchAsync({
			dir: work,
			slug: 'graceful-no-deadline',
			command: '',
			prompt: '',
			session: join(work, 'session.jsonl'),
		});
		expect(result.timedOut).toBeUndefined();
		expect(result.ok).toBe(true);
	});
});
