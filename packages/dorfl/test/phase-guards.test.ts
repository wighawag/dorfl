import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	PHASES,
	PhaseGuardError,
	PhaseUsageError,
	activePhase,
	enterPhase,
	parsePhase,
	type Phase,
} from '../src/phase.js';
import {NullHarness, agentLaunchEnv} from '../src/harness.js';
import {PiHarness} from '../src/pi-harness.js';
import {runVerify} from '../src/verify.js';
import {runPrepare} from '../src/prepare.js';

/**
 * The CI phase mode's guards (task `ci-split-phase-mode-and-guards`): in the
 * `lock` and `apply` phases (whose jobs hold the write token) every chokepoint
 * that launches an agent or runs repository code throws a named
 * `PhaseGuardError` BEFORE doing anything; without a phase, and in the `agent`
 * phase, they behave as before.
 */

let restore: (() => void) | undefined;
let dir: string | undefined;

afterEach(() => {
	restore?.();
	restore = undefined;
	if (dir !== undefined) {
		rmSync(dir, {recursive: true, force: true});
		dir = undefined;
	}
});

function tmp(): string {
	dir = mkdtempSync(join(tmpdir(), 'dorfl-phase-guard-'));
	return dir;
}

describe('parsePhase', () => {
	it('accepts lock, agent and apply in GitHub Actions', () => {
		for (const phase of PHASES) {
			expect(parsePhase(phase, {env: {GITHUB_ACTIONS: 'true'}})).toBe(phase);
		}
	});

	it('rejects any phase outside GitHub Actions with a clear usage error', () => {
		for (const env of [{}, {GITHUB_ACTIONS: 'false'}]) {
			expect(() => parsePhase('agent', {env})).toThrow(PhaseUsageError);
			expect(() => parsePhase('agent', {env})).toThrow(/CI-only/);
		}
	});

	it('the explicit test override admits a phase outside GitHub Actions', () => {
		expect(parsePhase('apply', {env: {}, allowOutsideActions: true})).toBe(
			'apply',
		);
	});

	it('rejects an unknown phase even in GitHub Actions', () => {
		expect(() => parsePhase('build', {env: {GITHUB_ACTIONS: 'true'}})).toThrow(
			/must be one of lock, agent, apply/,
		);
	});
});

describe('the active phase', () => {
	it('is undefined by default and restored by enterPhase', () => {
		expect(activePhase()).toBeUndefined();
		const undo = enterPhase('lock');
		expect(activePhase()).toBe('lock');
		const undoInner = enterPhase('apply');
		expect(activePhase()).toBe('apply');
		undoInner();
		expect(activePhase()).toBe('lock');
		undo();
		expect(activePhase()).toBeUndefined();
	});
});

describe.each<Phase>(['lock', 'apply'])('in the %s phase', (phase) => {
	it('agentLaunchEnv throws PhaseGuardError', () => {
		restore = enterPhase(phase);
		expect(() => agentLaunchEnv({})).toThrow(PhaseGuardError);
		try {
			agentLaunchEnv({});
		} catch (err) {
			expect(err).toMatchObject({
				name: 'PhaseGuardError',
				phase,
				operation: 'agent-launch-env',
			});
		}
	});

	it('the null harness launch throws before running anything', () => {
		const cwd = tmp();
		const marker = join(cwd, 'ran');
		restore = enterPhase(phase);
		expect(() =>
			new NullHarness().launch({
				dir: cwd,
				slug: 's',
				command: `touch ${marker}`,
			}),
		).toThrow(PhaseGuardError);
		expect(existsSync(marker)).toBe(false);
	});

	it('the pi harness launches (sync, async, interactive) throw', () => {
		const cwd = tmp();
		const pi = new PiHarness({piBin: '/nonexistent/pi'});
		restore = enterPhase(phase);
		const input = {dir: cwd, slug: 's', command: ''};
		expect(() => pi.launch(input)).toThrow(PhaseGuardError);
		expect(() => pi.launchAsync(input)).toThrow(PhaseGuardError);
		expect(() => pi.launchInteractive({dir: cwd, slug: 's'})).toThrow(
			PhaseGuardError,
		);
	});

	it('runVerify throws before running the gate', async () => {
		const cwd = tmp();
		const marker = join(cwd, 'ran');
		restore = enterPhase(phase);
		await expect(
			runVerify({
				cwd,
				verify: `touch ${marker}`,
				onStdout: () => {},
				onStderr: () => {},
			}),
		).rejects.toMatchObject({name: 'PhaseGuardError', operation: 'verify'});
		expect(existsSync(marker)).toBe(false);
	});

	it('runPrepare throws before running the step', async () => {
		const cwd = tmp();
		const marker = join(cwd, 'ran');
		restore = enterPhase(phase);
		await expect(
			runPrepare({
				cwd,
				prepare: `touch ${marker}`,
				onStdout: () => {},
				onStderr: () => {},
			}),
		).rejects.toMatchObject({name: 'PhaseGuardError', operation: 'prepare'});
		expect(existsSync(marker)).toBe(false);
	});
});

describe.each<Phase | undefined>([undefined, 'agent'])(
	'with phase %s the chokepoints run as before',
	(phase) => {
		it('agentLaunchEnv, a harness launch, runVerify and runPrepare all run', async () => {
			const cwd = tmp();
			writeFileSync(join(cwd, 'keep'), '');
			restore = enterPhase(phase);
			expect(agentLaunchEnv({FOO: 'bar'}).FOO).toBe('bar');
			const launched = new NullHarness().launch({
				dir: cwd,
				slug: 's',
				command: 'echo hi',
			});
			expect(launched.ok).toBe(true);
			const verify = await runVerify({
				cwd,
				verify: 'true',
				onStdout: () => {},
				onStderr: () => {},
			});
			expect(verify.passed).toBe(true);
			const prepare = await runPrepare({
				cwd,
				prepare: 'true',
				onStdout: () => {},
				onStderr: () => {},
			});
			expect(prepare.passed).toBe(true);
		});
	},
);
