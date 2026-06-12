import {describe, it, expect} from 'vitest';
import {ENV_PREFIX, envVarName, envOverrides} from '../src/env-config.js';

describe('envVarName', () => {
	it('prefixes AGENT_RUNNER_ and SCREAMING_SNAKEs the key', () => {
		expect(ENV_PREFIX).toBe('AGENT_RUNNER_');
		expect(envVarName('agentCmd')).toBe('AGENT_RUNNER_AGENT_CMD');
		expect(envVarName('piBin')).toBe('AGENT_RUNNER_PI_BIN');
		expect(envVarName('sessionsDir')).toBe('AGENT_RUNNER_SESSIONS_DIR');
		expect(envVarName('perRepoMax')).toBe('AGENT_RUNNER_PER_REPO_MAX');
		expect(envVarName('defaultArbiter')).toBe('AGENT_RUNNER_DEFAULT_ARBITER');
		// A single-word key stays a single SCREAMING word.
		expect(envVarName('model')).toBe('AGENT_RUNNER_MODEL');
		// `autoSlice` gets its env var for free off the mechanical mapping.
		expect(envVarName('autoSlice')).toBe('AGENT_RUNNER_AUTO_SLICE');
	});
});

describe('envOverrides — no env (regression)', () => {
	it('returns an empty object when no AGENT_RUNNER_* vars are set', () => {
		expect(envOverrides({})).toEqual({});
	});

	it('ignores unrelated env vars (no accidental key bleed)', () => {
		expect(envOverrides({PATH: '/usr/bin', HOME: '/home/x'})).toEqual({});
	});

	it('treats an absent var as unset, not as a value', () => {
		// `undefined` entries (as process.env yields for missing keys) are skipped.
		expect(envOverrides({AGENT_RUNNER_AGENT_CMD: undefined})).toEqual({});
	});
});

describe('envOverrides — string coercion', () => {
	it('passes string keys through verbatim', () => {
		expect(
			envOverrides({
				AGENT_RUNNER_AGENT_CMD: 'my-agent --flag',
				AGENT_RUNNER_PI_BIN: '/usr/local/bin/pi',
				AGENT_RUNNER_SESSIONS_DIR: '/srv/fleet-sessions',
				AGENT_RUNNER_DEFAULT_ARBITER: 'arbiter',
			}),
		).toEqual({
			agentCmd: 'my-agent --flag',
			piBin: '/usr/local/bin/pi',
			sessionsDir: '/srv/fleet-sessions',
			defaultArbiter: 'arbiter',
		});
	});

	it('keeps an empty string for a string key (not coerced away)', () => {
		expect(envOverrides({AGENT_RUNNER_AGENT_CMD: ''})).toEqual({agentCmd: ''});
	});
});

describe('envOverrides — boolean coercion', () => {
	it('accepts true and false', () => {
		expect(envOverrides({AGENT_RUNNER_AUTO_BUILD: 'true'})).toEqual({
			autoBuild: true,
		});
		expect(envOverrides({AGENT_RUNNER_AUTO_BUILD: 'false'})).toEqual({
			autoBuild: false,
		});
		// `autoSlice` coerces as a boolean exactly like `autoBuild`.
		expect(envOverrides({AGENT_RUNNER_AUTO_SLICE: 'true'})).toEqual({
			autoSlice: true,
		});
		expect(envOverrides({AGENT_RUNNER_AUTO_SLICE: 'false'})).toEqual({
			autoSlice: false,
		});
		// `prdsFirst` (the slices-first toggle) coerces as a boolean too.
		expect(envOverrides({AGENT_RUNNER_PRDS_FIRST: 'true'})).toEqual({
			prdsFirst: true,
		});
	});

	it('rejects an invalid autoSlice value LOUDLY, naming the variable', () => {
		expect(() => envOverrides({AGENT_RUNNER_AUTO_SLICE: 'yes'})).toThrow(
			/AGENT_RUNNER_AUTO_SLICE/,
		);
		expect(() => envOverrides({AGENT_RUNNER_AUTO_SLICE: 'yes'})).toThrow(
			/true.*false/i,
		);
	});

	it('rejects anything else LOUDLY, naming the variable', () => {
		expect(() => envOverrides({AGENT_RUNNER_AUTO_BUILD: 'yes'})).toThrow(
			/AGENT_RUNNER_AUTO_BUILD/,
		);
		expect(() => envOverrides({AGENT_RUNNER_AUTO_BUILD: 'yes'})).toThrow(
			/true.*false/i,
		);
		// Case matters: `True`/`1` are NOT accepted (avoids silent ambiguity).
		expect(() => envOverrides({AGENT_RUNNER_AUTO_BUILD: 'True'})).toThrow(
			/AGENT_RUNNER_AUTO_BUILD/,
		);
		expect(() => envOverrides({AGENT_RUNNER_AUTO_BUILD: '1'})).toThrow(
			/AGENT_RUNNER_AUTO_BUILD/,
		);
	});
});

describe('envOverrides — the deprecated AGENT_RUNNER_ALLOW_AGENTS alias', () => {
	it('maps the legacy env var to autoBuild and warns (deprecation window)', () => {
		const warnings: string[] = [];
		expect(
			envOverrides({AGENT_RUNNER_ALLOW_AGENTS: 'true'}, (m) =>
				warnings.push(m),
			),
		).toEqual({autoBuild: true});
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/AGENT_RUNNER_ALLOW_AGENTS/);
		expect(warnings[0]).toMatch(/autoBuild/);
	});

	it('coerces the legacy alias exactly like the canonical var (false)', () => {
		expect(
			envOverrides({AGENT_RUNNER_ALLOW_AGENTS: 'false'}, () => {}),
		).toEqual({autoBuild: false});
	});

	it('rejects an invalid legacy-alias value LOUDLY, naming the variable', () => {
		expect(() =>
			envOverrides({AGENT_RUNNER_ALLOW_AGENTS: 'yes'}, () => {}),
		).toThrow(/AGENT_RUNNER_ALLOW_AGENTS/);
	});

	it('lets the canonical AGENT_RUNNER_AUTO_BUILD WIN when both are set', () => {
		expect(
			envOverrides(
				{
					AGENT_RUNNER_AUTO_BUILD: 'false',
					AGENT_RUNNER_ALLOW_AGENTS: 'true',
				},
				() => {},
			),
		).toEqual({autoBuild: false});
	});
});

describe('envOverrides — number coercion', () => {
	it('parses numeric values', () => {
		expect(envOverrides({AGENT_RUNNER_MAX_PARALLEL: '8'})).toEqual({
			maxParallel: 8,
		});
		expect(envOverrides({AGENT_RUNNER_PER_REPO_MAX: '3'})).toEqual({
			perRepoMax: 3,
		});
	});

	it('rejects NaN / non-numeric / empty LOUDLY, naming the variable', () => {
		expect(() => envOverrides({AGENT_RUNNER_MAX_PARALLEL: 'lots'})).toThrow(
			/AGENT_RUNNER_MAX_PARALLEL/,
		);
		expect(() => envOverrides({AGENT_RUNNER_MAX_PARALLEL: 'lots'})).toThrow(
			/number/i,
		);
		expect(() => envOverrides({AGENT_RUNNER_PER_REPO_MAX: ''})).toThrow(
			/AGENT_RUNNER_PER_REPO_MAX/,
		);
	});
});

describe('envOverrides — enum coercion', () => {
	it('accepts a valid enum member', () => {
		expect(envOverrides({AGENT_RUNNER_INTEGRATION: 'merge'})).toEqual({
			integration: 'merge',
		});
		expect(envOverrides({AGENT_RUNNER_INTEGRATION: 'propose'})).toEqual({
			integration: 'propose',
		});
		expect(envOverrides({AGENT_RUNNER_HARNESS: 'pi'})).toEqual({harness: 'pi'});
		expect(envOverrides({AGENT_RUNNER_PROVIDER: 'github'})).toEqual({
			provider: 'github',
		});
	});

	it('rejects a value outside the union LOUDLY, naming the variable + options', () => {
		expect(() => envOverrides({AGENT_RUNNER_INTEGRATION: 'rebase'})).toThrow(
			/AGENT_RUNNER_INTEGRATION/,
		);
		expect(() => envOverrides({AGENT_RUNNER_INTEGRATION: 'rebase'})).toThrow(
			/propose.*merge|merge.*propose/,
		);
		expect(() => envOverrides({AGENT_RUNNER_HARNESS: 'docker'})).toThrow(
			/AGENT_RUNNER_HARNESS/,
		);
	});
});

describe('envOverrides — list coercion', () => {
	it('splits comma-separated list keys (cross-platform, not `:`)', () => {
		expect(envOverrides({AGENT_RUNNER_VERIFY: 'build,test,format'})).toEqual({
			verify: ['build', 'test', 'format'],
		});
	});

	it('trims whitespace and drops empty entries', () => {
		expect(envOverrides({AGENT_RUNNER_VERIFY: ' build , test ,'})).toEqual({
			verify: ['build', 'test'],
		});
	});

	it('an empty list var clears the list (explicit empty)', () => {
		expect(envOverrides({AGENT_RUNNER_VERIFY: ''})).toEqual({verify: []});
	});

	it('ignores a removed list key env var (roots is gone)', () => {
		// `roots`/`include`/`exclude` no longer exist (registry model): an env var
		// named for one of them contributes nothing.
		expect(envOverrides({AGENT_RUNNER_ROOTS: '/a,/b'})).toEqual({});
	});
});

describe('envOverrides — host-only keys are allowed (per-machine source)', () => {
	it('sets host-only keys env (piBin, agentCmd, maxParallel)', () => {
		expect(
			envOverrides({
				AGENT_RUNNER_PI_BIN: '/opt/pi',
				AGENT_RUNNER_AGENT_CMD: 'agent',
				AGENT_RUNNER_MAX_PARALLEL: '2',
				AGENT_RUNNER_WORKSPACES_DIR: '/tmp/ws',
				AGENT_RUNNER_ARBITERS_DIR: '/tmp/arb',
			}),
		).toEqual({
			piBin: '/opt/pi',
			agentCmd: 'agent',
			maxParallel: 2,
			workspacesDir: '/tmp/ws',
			arbitersDir: '/tmp/arb',
		});
	});
});
