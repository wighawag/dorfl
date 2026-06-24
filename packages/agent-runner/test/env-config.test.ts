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
		// `autoTask` gets its env var for free off the mechanical mapping.
		expect(envVarName('autoTask')).toBe('AGENT_RUNNER_AUTO_TASK');
		// `taskingIntegration` (the per-TRANSITION TASKING override) maps mechanically,
		// so `AGENT_RUNNER_TASKING_INTEGRATION` resolves
		// (`per-transition-integration-mode-slicing-vs-build`).
		expect(envVarName('taskingIntegration')).toBe(
			'AGENT_RUNNER_TASKING_INTEGRATION',
		);
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
		// `autoTask` coerces as a boolean exactly like `autoBuild`.
		expect(envOverrides({AGENT_RUNNER_AUTO_TASK: 'true'})).toEqual({
			autoTask: true,
		});
		expect(envOverrides({AGENT_RUNNER_AUTO_TASK: 'false'})).toEqual({
			autoTask: false,
		});
		// `surfaceBlockers` (the blocked-work gate) coerces as a boolean too.
		expect(envOverrides({AGENT_RUNNER_SURFACE_BLOCKERS: 'true'})).toEqual({
			surfaceBlockers: true,
		});
		expect(envOverrides({AGENT_RUNNER_SURFACE_BLOCKERS: 'false'})).toEqual({
			surfaceBlockers: false,
		});
	});

	it('rejects an invalid surfaceBlockers value LOUDLY, naming the variable', () => {
		expect(() => envOverrides({AGENT_RUNNER_SURFACE_BLOCKERS: 'on'})).toThrow(
			/AGENT_RUNNER_SURFACE_BLOCKERS/,
		);
		expect(() => envOverrides({AGENT_RUNNER_SURFACE_BLOCKERS: 'on'})).toThrow(
			/true.*false/i,
		);
	});

	it('rejects an invalid autoTask value LOUDLY, naming the variable', () => {
		expect(() => envOverrides({AGENT_RUNNER_AUTO_TASK: 'yes'})).toThrow(
			/AGENT_RUNNER_AUTO_TASK/,
		);
		expect(() => envOverrides({AGENT_RUNNER_AUTO_TASK: 'yes'})).toThrow(
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

describe('envOverrides — the retired AGENT_RUNNER_ALLOW_AGENTS env var', () => {
	it('no longer maps to autoBuild: it is ignored like any unknown var (no crash)', () => {
		// `AGENT_RUNNER_ALLOW_AGENTS` is no longer a recognised legacy alias; it is
		// simply an unknown env var, so it contributes nothing and never throws.
		expect(envOverrides({AGENT_RUNNER_ALLOW_AGENTS: 'true'})).toEqual({});
		expect(
			envOverrides({
				AGENT_RUNNER_ALLOW_AGENTS: 'true',
				AGENT_RUNNER_AUTO_BUILD: 'false',
			}),
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

describe('envOverrides — noPR (the PR-INTENT axis) boolean coercion', () => {
	it('coerces AGENT_RUNNER_NO_PR=true/false to a boolean', () => {
		expect(envOverrides({AGENT_RUNNER_NO_PR: 'true'})).toEqual({noPR: true});
		expect(envOverrides({AGENT_RUNNER_NO_PR: 'false'})).toEqual({noPR: false});
	});
});

describe('envOverrides — promptGuidance.testFirst (the NUDGE namespace, nested env)', () => {
	it('coerces AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST=true to {promptGuidance:{testFirst:true}}', () => {
		expect(
			envOverrides({AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST: 'true'}),
		).toEqual({promptGuidance: {testFirst: true}});
	});

	it('coerces AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST=false to {promptGuidance:{testFirst:false}}', () => {
		expect(
			envOverrides({AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST: 'false'}),
		).toEqual({promptGuidance: {testFirst: false}});
	});

	it('an absent env var leaves the namespace untouched (no `promptGuidance` key)', () => {
		expect(envOverrides({})).toEqual({});
	});

	it('FAILS LOUDLY on a non-boolean value (the same loud-failure contract as `autoBuild`)', () => {
		expect(() =>
			envOverrides({AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST: 'yes'}),
		).toThrow(/AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST/);
	});
});

describe('envOverrides — deprecated AGENT_RUNNER_PROVIDER is IGNORED with a warning', () => {
	it('ignores AGENT_RUNNER_PROVIDER (no override key) and warns', () => {
		const warnings: string[] = [];
		const result = envOverrides({AGENT_RUNNER_PROVIDER: 'github'}, (m) =>
			warnings.push(m),
		);
		// The removed override is NOT carried as any config key (no `provider`).
		expect(result).toEqual({});
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toMatch(/AGENT_RUNNER_PROVIDER/);
		expect(warnings[0]).toMatch(/arbiter-derived/);
	});

	it('a stale AGENT_RUNNER_PROVIDER=none warning points at NO_PR', () => {
		const warnings: string[] = [];
		envOverrides({AGENT_RUNNER_PROVIDER: 'none'}, (m) => warnings.push(m));
		expect(warnings[0]).toMatch(/NO_PR/);
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
		// `taskingIntegration` coerces as the SAME propose/merge enum as `integration`
		// (`per-transition-integration-mode-slicing-vs-build`).
		expect(envOverrides({AGENT_RUNNER_TASKING_INTEGRATION: 'merge'})).toEqual({
			taskingIntegration: 'merge',
		});
		expect(envOverrides({AGENT_RUNNER_TASKING_INTEGRATION: 'propose'})).toEqual(
			{
				taskingIntegration: 'propose',
			},
		);
		// `tasksLandIn` (the per-repo TASK-PLACEMENT default, task
		// `runner-deterministic-slice-placement-policy-and-precedence`) coerces as
		// the `pre-backlog`/`ready` enum, on the
		// SAME flag > env > per-repo > global > built-in chain as
		// `taskingIntegration`. The legacy `'backlog'`/`'todo'` pool spellings are NOT
		// accepted (clean break — ADR `rename-task-pool-folder-todo-to-ready`).
		expect(envOverrides({AGENT_RUNNER_TASKS_LAND_IN: 'ready'})).toEqual({
			tasksLandIn: 'ready',
		});
		expect(envOverrides({AGENT_RUNNER_TASKS_LAND_IN: 'pre-backlog'})).toEqual({
			tasksLandIn: 'pre-backlog',
		});
		// `observationTriage` is a 3-state ENUM coercion (like `integration`).
		expect(envOverrides({AGENT_RUNNER_OBSERVATION_TRIAGE: 'off'})).toEqual({
			observationTriage: 'off',
		});
		expect(envOverrides({AGENT_RUNNER_OBSERVATION_TRIAGE: 'ask'})).toEqual({
			observationTriage: 'ask',
		});
		expect(envOverrides({AGENT_RUNNER_OBSERVATION_TRIAGE: 'auto'})).toEqual({
			observationTriage: 'auto',
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
		// The observation-triage enum FAILS LOUDLY on a typo (incl. the old boolean
		// `false` — the deliberate non-alias TRAP the task avoids by not aliasing).
		expect(() =>
			envOverrides({AGENT_RUNNER_OBSERVATION_TRIAGE: 'yes'}),
		).toThrow(/AGENT_RUNNER_OBSERVATION_TRIAGE/);
		expect(() =>
			envOverrides({AGENT_RUNNER_OBSERVATION_TRIAGE: 'yes'}),
		).toThrow(/off.*ask.*auto/);
		expect(() =>
			envOverrides({AGENT_RUNNER_OBSERVATION_TRIAGE: 'false'}),
		).toThrow(/AGENT_RUNNER_OBSERVATION_TRIAGE/);
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

	it('AGENT_RUNNER_PREPARE coerces as a list (the env-prep sibling of verify)', () => {
		expect(
			envOverrides({
				AGENT_RUNNER_PREPARE: 'pnpm install,git submodule update --init',
			}),
		).toEqual({prepare: ['pnpm install', 'git submodule update --init']});
	});

	it('selectionOrder coerces as a `list` (explicit pool order)', () => {
		expect(
			envOverrides({
				AGENT_RUNNER_SELECTION_ORDER: 'build,task,surface,triage',
			}),
		).toEqual({selectionOrder: ['build', 'task', 'surface', 'triage']});
	});

	it('selectionOrder env SINGLE-keyword form yields a one-element list (the resolver expands it)', () => {
		// `AGENT_RUNNER_SELECTION_ORDER=drain` ⇒ the `'list'` coercion gives `['drain']`;
		// `resolveSelectionOrder` then expands the lone preset keyword (asserted in
		// select-order.test.ts). Here we pin the env-layer half: a one-element list.
		expect(envOverrides({AGENT_RUNNER_SELECTION_ORDER: 'drain'})).toEqual({
			selectionOrder: ['drain'],
		});
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
