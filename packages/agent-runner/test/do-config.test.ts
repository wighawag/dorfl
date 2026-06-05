import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mergeConfig} from '../src/config.js';
import {resolveRepoConfig} from '../src/repo-config.js';
import {doFlagOverrides, doNeedsAgentCmd} from '../src/do-config.js';

/**
 * The `do-threads-harness-flags` slice: `do` DECLARES `--harness`,
 * `--agent-cmd`, `--pi-bin`, `--model` but its action used to pass ONLY
 * `{integration}` to {@link resolveRepoConfig}, silently dropping the rest — so
 * `do --harness pi` was ignored and `do` wrongly demanded `agentCmd`.
 *
 * These tests pin the FIX: the `do` flags fold into the SAME flag-override
 * `PartialConfig` `run` uses (via {@link doFlagOverrides}, which reuses
 * `runFlagOverrides`'s per-key mapping) and resolve through the SAME precedence
 * chain (flag > env > per-repo > global > default), AND the no-config
 * null-default guard ({@link doNeedsAgentCmd}) still fires.
 */

let repo: string;
beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), 'agent-runner-do-config-'));
});
afterEach(() => {
	rmSync(repo, {recursive: true, force: true});
});

describe('doFlagOverrides — folds the do CLI flags into a PartialConfig', () => {
	it('maps --harness pi into the overrides', () => {
		const overrides = doFlagOverrides({harness: 'pi'});
		expect(overrides.harness).toBe('pi');
	});

	it('maps --agent-cmd / --pi-bin / --model / --sessions-dir', () => {
		const overrides = doFlagOverrides({
			harness: 'null',
			agentCmd: 'run-agent --slug',
			piBin: '/opt/pi',
			model: 'anthropic/x',
			sessionsDir: '/var/fleet/sessions',
		});
		expect(overrides.harness).toBe('null');
		expect(overrides.agentCmd).toBe('run-agent --slug');
		expect(overrides.piBin).toBe('/opt/pi');
		expect(overrides.model).toBe('anthropic/x');
		expect(overrides.sessionsDir).toBe('/var/fleet/sessions');
	});

	it('folds the integrate-time mode in (so {integration} is NOT lost)', () => {
		expect(doFlagOverrides({}, 'merge').integration).toBe('merge');
		expect(doFlagOverrides({}, 'propose').integration).toBe('propose');
		// No flag mode ⇒ integration is left to per-repo/global/default.
		expect(doFlagOverrides({}).integration).toBeUndefined();
	});

	it('sets only what was passed (absent flags ⇒ absent keys)', () => {
		const overrides = doFlagOverrides({});
		expect(overrides.harness).toBeUndefined();
		expect(overrides.agentCmd).toBeUndefined();
		expect(overrides.piBin).toBeUndefined();
		expect(overrides.model).toBeUndefined();
		expect(overrides.sessionsDir).toBeUndefined();
		expect(overrides.integration).toBeUndefined();
	});
});

describe('do — flags resolve through resolveRepoConfig (the bug fix)', () => {
	it('do --harness pi resolves the pi adapter (no agentCmd demanded)', () => {
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			flags: doFlagOverrides({harness: 'pi'}),
		});
		expect(resolved.config.harness).toBe('pi');
		// pi adapter does not consume agentCmd ⇒ the null-default guard must NOT fire.
		expect(doNeedsAgentCmd(resolved.config)).toBe(false);
	});

	it('do --harness null --agent-cmd <cmd> resolves the null adapter with that command', () => {
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			flags: doFlagOverrides({harness: 'null', agentCmd: 'my-agent {model}'}),
		});
		expect(resolved.config.harness).toBe('null');
		expect(resolved.config.agentCmd).toBe('my-agent {model}');
		expect(doNeedsAgentCmd(resolved.config)).toBe(false);
	});

	it('--pi-bin and --model flags take effect on the resolved config', () => {
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			flags: doFlagOverrides({
				harness: 'pi',
				piBin: '/custom/pi',
				model: 'routing/intent',
			}),
		});
		expect(resolved.config.piBin).toBe('/custom/pi');
		expect(resolved.config.model).toBe('routing/intent');
	});

	it('the flags fold through the SAME chain run/complete use (flag > env > per-repo > global > default)', () => {
		// global sets harness pi; a --harness null flag must WIN (flag > global).
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({harness: 'pi', model: 'global/m'}),
			env: {AGENT_RUNNER_MODEL: 'env/m'},
			flags: doFlagOverrides({harness: 'null', agentCmd: 'c', model: 'flag/m'}),
		});
		expect(resolved.config.harness).toBe('null');
		// flag beats env beats global for model too.
		expect(resolved.config.model).toBe('flag/m');
	});
});

describe('do — null-default guard (no regression)', () => {
	it('with NO harness flags + NO config the null-default guard STILL fires', () => {
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			// Inject an empty env so an ambient AGENT_RUNNER_* (e.g. a runner that
			// exports AGENT_RUNNER_HARNESS) cannot perturb this no-config assertion.
			env: {},
			flags: doFlagOverrides({}),
		});
		// Default harness is the null adapter (unset, ≠ 'pi') and agentCmd is empty
		// ⇒ the guard demands agentCmd.
		expect(resolved.config.harness).not.toBe('pi');
		expect(resolved.config.agentCmd.trim()).toBe('');
		expect(doNeedsAgentCmd(resolved.config)).toBe(true);
	});
});
