import {describe, it, expect} from 'vitest';
import {ENV_PREFIX, envVarName, envOverrides} from '../src/env-config.js';

describe('envVarName', () => {
	it('prefixes DORFL_ and SCREAMING_SNAKEs the key', () => {
		expect(ENV_PREFIX).toBe('DORFL_');
		expect(envVarName('agentCmd')).toBe('DORFL_AGENT_CMD');
		expect(envVarName('piBin')).toBe('DORFL_PI_BIN');
		expect(envVarName('sessionsDir')).toBe('DORFL_SESSIONS_DIR');
		expect(envVarName('perRepoMax')).toBe('DORFL_PER_REPO_MAX');
		expect(envVarName('defaultArbiter')).toBe('DORFL_DEFAULT_ARBITER');
		// A single-word key stays a single SCREAMING word.
		expect(envVarName('model')).toBe('DORFL_MODEL');
		// `autoTask` gets its env var for free off the mechanical mapping.
		expect(envVarName('autoTask')).toBe('DORFL_AUTO_TASK');
		// `taskingIntegration` (the per-TRANSITION TASKING override) maps mechanically,
		// so `DORFL_TASKING_INTEGRATION` resolves
		// (`per-transition-integration-mode-slicing-vs-build`).
		expect(envVarName('taskingIntegration')).toBe('DORFL_TASKING_INTEGRATION');
	});
});

describe('envOverrides — no env (regression)', () => {
	it('returns an empty object when no DORFL_* vars are set', () => {
		expect(envOverrides({})).toEqual({});
	});

	it('ignores unrelated env vars (no accidental key bleed)', () => {
		expect(envOverrides({PATH: '/usr/bin', HOME: '/home/x'})).toEqual({});
	});

	it('treats an absent var as unset, not as a value', () => {
		// `undefined` entries (as process.env yields for missing keys) are skipped.
		expect(envOverrides({DORFL_AGENT_CMD: undefined})).toEqual({});
	});
});

describe('envOverrides — string coercion', () => {
	it('passes string keys through verbatim', () => {
		expect(
			envOverrides({
				DORFL_AGENT_CMD: 'my-agent --flag',
				DORFL_PI_BIN: '/usr/local/bin/pi',
				DORFL_SESSIONS_DIR: '/srv/fleet-sessions',
				DORFL_DEFAULT_ARBITER: 'arbiter',
			}),
		).toEqual({
			agentCmd: 'my-agent --flag',
			piBin: '/usr/local/bin/pi',
			sessionsDir: '/srv/fleet-sessions',
			defaultArbiter: 'arbiter',
		});
	});

	it('keeps an empty string for a string key (not coerced away)', () => {
		expect(envOverrides({DORFL_AGENT_CMD: ''})).toEqual({agentCmd: ''});
	});
});

describe('envOverrides — boolean coercion', () => {
	it('accepts true and false', () => {
		expect(envOverrides({DORFL_AUTO_BUILD: 'true'})).toEqual({
			autoBuild: true,
		});
		expect(envOverrides({DORFL_AUTO_BUILD: 'false'})).toEqual({
			autoBuild: false,
		});
		// `autoTask` coerces as a boolean exactly like `autoBuild`.
		expect(envOverrides({DORFL_AUTO_TASK: 'true'})).toEqual({
			autoTask: true,
		});
		expect(envOverrides({DORFL_AUTO_TASK: 'false'})).toEqual({
			autoTask: false,
		});
		// `surfaceBlockers` (the blocked-work gate) coerces as a boolean too.
		expect(envOverrides({DORFL_SURFACE_BLOCKERS: 'true'})).toEqual({
			surfaceBlockers: true,
		});
		expect(envOverrides({DORFL_SURFACE_BLOCKERS: 'false'})).toEqual({
			surfaceBlockers: false,
		});
	});

	it('rejects an invalid surfaceBlockers value LOUDLY, naming the variable', () => {
		expect(() => envOverrides({DORFL_SURFACE_BLOCKERS: 'on'})).toThrow(
			/DORFL_SURFACE_BLOCKERS/,
		);
		expect(() => envOverrides({DORFL_SURFACE_BLOCKERS: 'on'})).toThrow(
			/true.*false/i,
		);
	});

	it('rejects an invalid autoTask value LOUDLY, naming the variable', () => {
		expect(() => envOverrides({DORFL_AUTO_TASK: 'yes'})).toThrow(
			/DORFL_AUTO_TASK/,
		);
		expect(() => envOverrides({DORFL_AUTO_TASK: 'yes'})).toThrow(
			/true.*false/i,
		);
	});

	it('rejects anything else LOUDLY, naming the variable', () => {
		expect(() => envOverrides({DORFL_AUTO_BUILD: 'yes'})).toThrow(
			/DORFL_AUTO_BUILD/,
		);
		expect(() => envOverrides({DORFL_AUTO_BUILD: 'yes'})).toThrow(
			/true.*false/i,
		);
		// Case matters: `True`/`1` are NOT accepted (avoids silent ambiguity).
		expect(() => envOverrides({DORFL_AUTO_BUILD: 'True'})).toThrow(
			/DORFL_AUTO_BUILD/,
		);
		expect(() => envOverrides({DORFL_AUTO_BUILD: '1'})).toThrow(
			/DORFL_AUTO_BUILD/,
		);
	});
});

describe('envOverrides — the retired DORFL_ALLOW_AGENTS env var', () => {
	it('no longer maps to autoBuild: it is ignored like any unknown var (no crash)', () => {
		// `DORFL_ALLOW_AGENTS` is no longer a recognised legacy alias; it is
		// simply an unknown env var, so it contributes nothing and never throws.
		expect(envOverrides({DORFL_ALLOW_AGENTS: 'true'})).toEqual({});
		expect(
			envOverrides({
				DORFL_ALLOW_AGENTS: 'true',
				DORFL_AUTO_BUILD: 'false',
			}),
		).toEqual({autoBuild: false});
	});
});

describe('envOverrides — number coercion', () => {
	it('parses numeric values', () => {
		expect(envOverrides({DORFL_MAX_PARALLEL: '8'})).toEqual({
			maxParallel: 8,
		});
		expect(envOverrides({DORFL_PER_REPO_MAX: '3'})).toEqual({
			perRepoMax: 3,
		});
	});

	it('rejects NaN / non-numeric / empty LOUDLY, naming the variable', () => {
		expect(() => envOverrides({DORFL_MAX_PARALLEL: 'lots'})).toThrow(
			/DORFL_MAX_PARALLEL/,
		);
		expect(() => envOverrides({DORFL_MAX_PARALLEL: 'lots'})).toThrow(/number/i);
		expect(() => envOverrides({DORFL_PER_REPO_MAX: ''})).toThrow(
			/DORFL_PER_REPO_MAX/,
		);
	});
});

describe('envOverrides — noPR (the PR-INTENT axis) boolean coercion', () => {
	it('coerces DORFL_NO_PR=true/false to a boolean', () => {
		expect(envOverrides({DORFL_NO_PR: 'true'})).toEqual({noPR: true});
		expect(envOverrides({DORFL_NO_PR: 'false'})).toEqual({noPR: false});
	});
});

describe('envOverrides — promptGuidance.testFirst (the NUDGE namespace, nested env)', () => {
	it('coerces DORFL_PROMPT_GUIDANCE_TEST_FIRST=true to {promptGuidance:{testFirst:true}}', () => {
		expect(envOverrides({DORFL_PROMPT_GUIDANCE_TEST_FIRST: 'true'})).toEqual({
			promptGuidance: {testFirst: true},
		});
	});

	it('coerces DORFL_PROMPT_GUIDANCE_TEST_FIRST=false to {promptGuidance:{testFirst:false}}', () => {
		expect(envOverrides({DORFL_PROMPT_GUIDANCE_TEST_FIRST: 'false'})).toEqual({
			promptGuidance: {testFirst: false},
		});
	});

	it('an absent env var leaves the namespace untouched (no `promptGuidance` key)', () => {
		expect(envOverrides({})).toEqual({});
	});

	it('FAILS LOUDLY on a non-boolean value (the same loud-failure contract as `autoBuild`)', () => {
		expect(() =>
			envOverrides({DORFL_PROMPT_GUIDANCE_TEST_FIRST: 'yes'}),
		).toThrow(/DORFL_PROMPT_GUIDANCE_TEST_FIRST/);
	});
});

describe('envOverrides — deprecated DORFL_PROVIDER is IGNORED with a warning', () => {
	it('ignores DORFL_PROVIDER (no override key) and warns', () => {
		const warnings: string[] = [];
		const result = envOverrides({DORFL_PROVIDER: 'github'}, (m) =>
			warnings.push(m),
		);
		// The removed override is NOT carried as any config key (no `provider`).
		expect(result).toEqual({});
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toMatch(/DORFL_PROVIDER/);
		expect(warnings[0]).toMatch(/arbiter-derived/);
	});

	it('a stale DORFL_PROVIDER=none warning points at NO_PR', () => {
		const warnings: string[] = [];
		envOverrides({DORFL_PROVIDER: 'none'}, (m) => warnings.push(m));
		expect(warnings[0]).toMatch(/NO_PR/);
	});
});

describe('envOverrides — enum coercion', () => {
	it('accepts a valid enum member', () => {
		expect(envOverrides({DORFL_INTEGRATION: 'merge'})).toEqual({
			integration: 'merge',
		});
		expect(envOverrides({DORFL_INTEGRATION: 'propose'})).toEqual({
			integration: 'propose',
		});
		expect(envOverrides({DORFL_HARNESS: 'pi'})).toEqual({harness: 'pi'});
		// `taskingIntegration` coerces as the SAME propose/merge enum as `integration`
		// (`per-transition-integration-mode-slicing-vs-build`).
		expect(envOverrides({DORFL_TASKING_INTEGRATION: 'merge'})).toEqual({
			taskingIntegration: 'merge',
		});
		expect(envOverrides({DORFL_TASKING_INTEGRATION: 'propose'})).toEqual({
			taskingIntegration: 'propose',
		});
		// `tasksLandIn` (the per-repo TASK-PLACEMENT default, task
		// `runner-deterministic-slice-placement-policy-and-precedence`) coerces as
		// the `backlog`/`ready` enum, on the
		// SAME flag > env > per-repo > global > built-in chain as
		// `taskingIntegration`. The legacy `'pre-backlog'` staging spelling and the
		// legacy `'todo'` pool spelling are NOT accepted (clean break — the staging
		// value was renamed `'pre-backlog'` → `'backlog'`; the pool value was
		// renamed `'backlog'` → `'todo'` → `'ready'`, ADR
		// `rename-task-pool-folder-todo-to-ready`).
		expect(envOverrides({DORFL_TASKS_LAND_IN: 'ready'})).toEqual({
			tasksLandIn: 'ready',
		});
		expect(envOverrides({DORFL_TASKS_LAND_IN: 'backlog'})).toEqual({
			tasksLandIn: 'backlog',
		});
		// HARD CUTOVER (spec `prd-to-spec-vocabulary-cutover-and-migration-command`):
		// `DORFL_SPECS_LAND_IN` (the sole spec-placement env) coerces the
		// `pre-proposed`/`ready` enum; the legacy `DORFL_PRDS_LAND_IN` is GONE.
		expect(envOverrides({DORFL_SPECS_LAND_IN: 'ready'})).toEqual({
			specsLandIn: 'ready',
		});
		// The UNTRUSTED-side TWINS (spec
		// `untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution`,
		// ADR `untrusted-origin-carries-via-stamp-not-forced-staging`) coerce the
		// SAME enums as their trusted twins on the SAME chain.
		expect(envOverrides({DORFL_UNTRUSTED_TASKS_LAND_IN: 'ready'})).toEqual({
			untrustedTasksLandIn: 'ready',
		});
		expect(envOverrides({DORFL_UNTRUSTED_TASKS_LAND_IN: 'backlog'})).toEqual({
			untrustedTasksLandIn: 'backlog',
		});
		expect(envOverrides({DORFL_UNTRUSTED_SPECS_LAND_IN: 'ready'})).toEqual({
			untrustedSpecsLandIn: 'ready',
		});
		expect(
			envOverrides({DORFL_UNTRUSTED_SPECS_LAND_IN: 'pre-proposed'}),
		).toEqual({untrustedSpecsLandIn: 'pre-proposed'});
		// The dead `DORFL_PRDS_LAND_IN` env is not coerced into any config key.
		expect(envOverrides({DORFL_PRDS_LAND_IN: 'pre-proposed'})).toEqual({});
		// `observationTriage` is a 3-state ENUM coercion (like `integration`).
		expect(envOverrides({DORFL_OBSERVATION_TRIAGE: 'off'})).toEqual({
			observationTriage: 'off',
		});
		expect(envOverrides({DORFL_OBSERVATION_TRIAGE: 'ask'})).toEqual({
			observationTriage: 'ask',
		});
		expect(envOverrides({DORFL_OBSERVATION_TRIAGE: 'auto'})).toEqual({
			observationTriage: 'auto',
		});
	});

	it('rejects a value outside the union LOUDLY, naming the variable + options', () => {
		expect(() => envOverrides({DORFL_INTEGRATION: 'rebase'})).toThrow(
			/DORFL_INTEGRATION/,
		);
		expect(() => envOverrides({DORFL_INTEGRATION: 'rebase'})).toThrow(
			/propose.*merge|merge.*propose/,
		);
		expect(() => envOverrides({DORFL_HARNESS: 'docker'})).toThrow(
			/DORFL_HARNESS/,
		);
		// The observation-triage enum FAILS LOUDLY on a typo (incl. the old boolean
		// `false` — the deliberate non-alias TRAP the task avoids by not aliasing).
		expect(() => envOverrides({DORFL_OBSERVATION_TRIAGE: 'yes'})).toThrow(
			/DORFL_OBSERVATION_TRIAGE/,
		);
		expect(() => envOverrides({DORFL_OBSERVATION_TRIAGE: 'yes'})).toThrow(
			/off.*ask.*auto/,
		);
		expect(() => envOverrides({DORFL_OBSERVATION_TRIAGE: 'false'})).toThrow(
			/DORFL_OBSERVATION_TRIAGE/,
		);
		// The untrusted-side placement TWINS FAIL LOUDLY on a bad value exactly like
		// their trusted twins, naming the offending variable + the valid options.
		expect(() => envOverrides({DORFL_UNTRUSTED_TASKS_LAND_IN: 'nope'})).toThrow(
			/DORFL_UNTRUSTED_TASKS_LAND_IN/,
		);
		expect(() => envOverrides({DORFL_UNTRUSTED_TASKS_LAND_IN: 'nope'})).toThrow(
			/backlog.*ready|ready.*backlog/,
		);
		expect(() => envOverrides({DORFL_UNTRUSTED_SPECS_LAND_IN: 'nope'})).toThrow(
			/DORFL_UNTRUSTED_SPECS_LAND_IN/,
		);
		expect(() => envOverrides({DORFL_UNTRUSTED_SPECS_LAND_IN: 'nope'})).toThrow(
			/pre-proposed.*ready|ready.*pre-proposed/,
		);
	});
});

describe('envOverrides — list coercion', () => {
	it('splits comma-separated list keys (cross-platform, not `:`)', () => {
		expect(envOverrides({DORFL_VERIFY: 'build,test,format'})).toEqual({
			verify: ['build', 'test', 'format'],
		});
	});

	it('trims whitespace and drops empty entries', () => {
		expect(envOverrides({DORFL_VERIFY: ' build , test ,'})).toEqual({
			verify: ['build', 'test'],
		});
	});

	it('an empty list var clears the list (explicit empty)', () => {
		expect(envOverrides({DORFL_VERIFY: ''})).toEqual({verify: []});
	});

	it('DORFL_PREPARE coerces as a list (the env-prep sibling of verify)', () => {
		expect(
			envOverrides({
				DORFL_PREPARE: 'pnpm install,git submodule update --init',
			}),
		).toEqual({prepare: ['pnpm install', 'git submodule update --init']});
	});

	it('selectionOrder coerces as a `list` (explicit pool order)', () => {
		expect(
			envOverrides({
				DORFL_SELECTION_ORDER: 'build,task,surface,triage',
			}),
		).toEqual({selectionOrder: ['build', 'task', 'surface', 'triage']});
	});

	it('selectionOrder env SINGLE-keyword form yields a one-element list (the resolver expands it)', () => {
		// `DORFL_SELECTION_ORDER=drain` ⇒ the `'list'` coercion gives `['drain']`;
		// `resolveSelectionOrder` then expands the lone preset keyword (asserted in
		// select-order.test.ts). Here we pin the env-layer half: a one-element list.
		expect(envOverrides({DORFL_SELECTION_ORDER: 'drain'})).toEqual({
			selectionOrder: ['drain'],
		});
	});

	it('ignores a removed list key env var (roots is gone)', () => {
		// `roots`/`include`/`exclude` no longer exist (registry model): an env var
		// named for one of them contributes nothing.
		expect(envOverrides({DORFL_ROOTS: '/a,/b'})).toEqual({});
	});
});

describe('envOverrides — host-only keys are allowed (per-machine source)', () => {
	it('sets host-only keys env (piBin, agentCmd, maxParallel)', () => {
		expect(
			envOverrides({
				DORFL_PI_BIN: '/opt/pi',
				DORFL_AGENT_CMD: 'agent',
				DORFL_MAX_PARALLEL: '2',
				DORFL_WORKSPACES_DIR: '/tmp/ws',
				DORFL_ARBITERS_DIR: '/tmp/arb',
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
