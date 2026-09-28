import {describe, it, expect} from 'vitest';
import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {
	buildSetupArtifacts,
	loadCapabilityRegistry,
	requiredSecretNames,
	type ResolvedCIConfig,
} from '../src/install-ci-core.js';
import {
	guardWorkflows,
	type GuardFile,
	type GuardViolation,
} from './helpers/workflow-guard.js';

/**
 * THE WORKFLOW GUARD (spec `ci-agent-job-without-write-token`, testing decision
 * 1; task `ci-split-generate-workflows`). Every workflow and composite action
 * `dorfl install-ci` generates, for every config shape, plus this repository's
 * own checked-in `.github/`, must keep the boundary: no agent in a job that can
 * write, no write credential in the agent job, one item per run, no cache. The
 * rules live in `helpers/workflow-guard.ts`.
 */

const PROVIDERS: ResolvedCIConfig['providers'] = [
	{
		name: 'anthropic',
		apiKeyEnvVar: 'ANTHROPIC_API_KEY',
		models: [{id: 'claude-sonnet-4-20250514'}],
		builtin: true,
	},
	{
		name: 'openai',
		apiKeyEnvVar: 'OPENAI_API_KEY',
		models: [{id: 'gpt-4o'}],
		builtin: true,
	},
];

const BASE: ResolvedCIConfig = {
	authMode: 'models-json',
	providers: PROVIDERS,
	defaultProvider: 'anthropic',
	defaultModel: 'claude-sonnet-4-20250514',
	harness: 'pi',
	installSource: 'registry',
	maxParallel: 2,
};

/** Every config shape that changes what the generators emit. */
const CONFIGS: {name: string; config: ResolvedCIConfig; hook?: string}[] = [
	{name: 'models-json/registry', config: BASE},
	{
		name: 'models-json/workspace',
		config: {...BASE, installSource: 'workspace'},
	},
	{name: 'public', config: {...BASE, repoVisibility: 'public'}},
	{name: 'private', config: {...BASE, repoVisibility: 'private'}},
	{name: 'internal', config: {...BASE, repoVisibility: 'internal'}},
	{name: 'maxParallel 5', config: {...BASE, maxParallel: 5}},
	{
		name: 'with project-setup hook',
		config: BASE,
		hook:
			'    - name: Install project deps\n' +
			'      shell: bash\n' +
			'      run: pnpm install --frozen-lockfile --ignore-scripts\n',
	},
];

/** The provider API key secrets of a config. */
function providerKeys(config: ResolvedCIConfig): Set<string> {
	return new Set(requiredSecretNames(config));
}

async function generated(): Promise<
	{name: string; config: ResolvedCIConfig; files: GuardFile[]}[]
> {
	const caps = await loadCapabilityRegistry();
	return CONFIGS.map(({name, config, hook}) => ({
		name,
		config,
		files: buildSetupArtifacts(config, caps, {projectSetupSteps: hook})
			.filter((f) => /\.ya?ml$/.test(f.path))
			.map((f) => ({path: f.path.split('\\').join('/'), content: f.content})),
	}));
}

const here = dirname(fileURLToPath(import.meta.url));
const GITHUB_DIR = join(here, '..', '..', '..', '.github');

/** This repository's checked-in workflows and composite actions. */
function checkedIn(): GuardFile[] {
	const out: GuardFile[] = [];
	for (const f of readdirSync(join(GITHUB_DIR, 'workflows'))) {
		if (/\.ya?ml$/.test(f)) {
			out.push({
				path: `workflows/${f}`,
				content: readFileSync(join(GITHUB_DIR, 'workflows', f), 'utf8'),
			});
		}
	}
	const actions = join(GITHUB_DIR, 'actions');
	if (existsSync(actions)) {
		for (const d of readdirSync(actions)) {
			for (const n of ['action.yml', 'action.yaml']) {
				const p = join(actions, d, n);
				if (existsSync(p)) {
					out.push({
						path: `actions/${d}/${n}`,
						content: readFileSync(p, 'utf8'),
					});
				}
			}
		}
	}
	return out;
}

/** The provider keys the checked-in setup action forwards (its inputs). */
function checkedInProviderKeys(files: GuardFile[]): Set<string> {
	const setup = files.find((f) => f.path === 'actions/dorfl-setup/action.yml');
	const doc = (setup ? parse(setup.content) : {}) as {
		inputs?: Record<string, unknown>;
	};
	return new Set(Object.keys(doc.inputs ?? {}));
}

function fmt(v: GuardViolation[]): string[] {
	return v.map((x) => `${x.file} ${x.job}: ${x.rule} (${x.detail})`);
}

const KEYS = new Set(['ANTHROPIC_API_KEY']);

/** Guard one inline workflow (plus optional extra files). */
function guardOne(
	yaml: string,
	extra: GuardFile[] = [],
	path = 'workflows/w.yml',
): GuardViolation[] {
	return guardWorkflows([{path, content: yaml}, ...extra], {
		providerKeys: KEYS,
	});
}

describe('the workflow guard: each rule fires on a bad fixture', () => {
	it('an agent-spawning verb without --phase lock|apply in a write job, or with a persisted checkout', () => {
		const write = guardOne(
			[
				'permissions: {contents: write}',
				'jobs:',
				'  item:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: dorfl advance "$ITEM" --merge',
			].join('\n'),
		);
		expect(write.map((v) => v.rule)).toEqual(['agent-verb-in-write-job']);

		const persisted = guardOne(
			[
				'permissions: {}',
				'jobs:',
				'  agent:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: read}',
				'    steps:',
				'      - uses: actions/checkout@v7',
				'      - run: dorfl intake 1 --phase agent --handoff-out x',
			].join('\n'),
		);
		expect(persisted.map((v) => v.rule)).toEqual(['agent-verb-in-write-job']);

		// The repository default token counts as write.
		const dflt = guardOne(
			[
				'jobs:',
				'  item:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: |',
				'          dorfl do task:x \\',
				'            --merge',
			].join('\n'),
		);
		expect(dflt.map((v) => v.rule)).toEqual(['agent-verb-in-write-job']);

		// A lock/apply phase is allowed in a write job; a read-only,
		// non-persisting agent job is allowed.
		const ok = guardOne(
			[
				'permissions: {}',
				'jobs:',
				'  lock:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: write}',
				'    steps:',
				'      - uses: actions/checkout@v7',
				'      - run: dorfl advance "$ITEM" --phase lock',
				'  agent:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: read}',
				'    steps:',
				'      - uses: actions/checkout@v7',
				'        with: {persist-credentials: false}',
				'      - run: dorfl advance "$ITEM" --phase agent',
			].join('\n'),
		);
		expect(fmt(ok)).toEqual([]);
	});

	it('verify is exempt (it runs repository code, no agent): a contents: read verify.yml that persists its checkout passes', () => {
		const v = guardOne(
			[
				'permissions: {}',
				'jobs:',
				'  verify:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: read}',
				'    steps:',
				'      - uses: actions/checkout@v7',
				'      - run: dorfl verify',
			].join('\n'),
		);
		expect(fmt(v)).toEqual([]);
	});

	it('a provider key in a lock/apply job; a foreign secret in the agent job', () => {
		const v = guardOne(
			[
				'permissions: {}',
				'jobs:',
				'  apply:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: write}',
				'    steps:',
				'      - run: dorfl advance x --phase apply',
				'        env: {K: "${{ secrets.ANTHROPIC_API_KEY }}"}',
				'  agent:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: read}',
				'    steps:',
				'      - run: dorfl advance x --phase agent',
				'        env:',
				'          GH_TOKEN: ${{ secrets.DORFL_GH_TOKEN }}',
				'          A: ${{ secrets.ANTHROPIC_API_KEY }}',
				'          B: ${{ secrets.GITHUB_TOKEN }}',
			].join('\n'),
		);
		expect(v.map((x) => `${x.job}:${x.rule}:${x.detail}`)).toEqual([
			'apply:provider-key-in-write-phase:references secrets.ANTHROPIC_API_KEY',
			'agent:agent-job-foreign-secret:references secrets.DORFL_GH_TOKEN',
		]);
	});

	it('the agent job accepts ONLY provider credentials: the removed auth-json secrets are foreign', () => {
		// The removed auth-json mode's PI_AUTH_JSON blob and its write-capable
		// GH_PAT (for OAuth rotation) are NOT provider keys, so an agent job that
		// references either is flagged (ADR ci-agent-job-holds-no-write-token).
		const v = guardOne(
			[
				'permissions: {}',
				'jobs:',
				'  agent:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: read}',
				'    steps:',
				'      - run: dorfl advance x --phase agent',
				'        env:',
				'          A: ${{ secrets.ANTHROPIC_API_KEY }}',
				'          P: ${{ secrets.PI_AUTH_JSON }}',
				'          G: ${{ secrets.GH_PAT }}',
			].join('\n'),
		);
		expect(v.map((x) => `${x.job}:${x.rule}:${x.detail}`)).toEqual([
			'agent:agent-job-foreign-secret:references secrets.PI_AUTH_JSON',
			'agent:agent-job-foreign-secret:references secrets.GH_PAT',
		]);
	});

	it('an agent in a matrix, and a matrix calling the item workflows', () => {
		const v = guardOne(
			[
				'permissions: {}',
				'jobs:',
				'  legs:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: read}',
				'    strategy: {matrix: {item: [a, b]}}',
				'    steps:',
				'      - run: dorfl advance "$ITEM" --phase agent',
				'  calls:',
				'    strategy: {matrix: {item: [a, b]}}',
				'    uses: ./.github/workflows/dorfl-item-dispatch.yml',
			].join('\n'),
		);
		expect(v.map((x) => `${x.job}:${x.rule}`)).toEqual([
			'legs:agent-in-matrix',
			'calls:agent-in-matrix',
		]);
	});

	it('any cache restore, also through a local composite action, in any job', () => {
		const action: GuardFile = {
			path: 'actions/s/action.yml',
			content: [
				'runs:',
				'  using: composite',
				'  steps:',
				'    - uses: actions/setup-node@abc',
				'      with: {node-version: 22}',
			].join('\n'),
		};
		const v = guardOne(
			[
				'permissions: {}',
				'jobs:',
				'  a:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: read}',
				'    steps:',
				'      - uses: actions/cache/restore@v4',
				'      - uses: ./.github/actions/s',
			].join('\n'),
			[action],
		);
		expect(v.map((x) => x.rule)).toEqual(['cache-restore', 'cache-restore']);
	});

	it('actions: write next to a checkout or a setup step', () => {
		const v = guardOne(
			[
				'permissions: {}',
				'jobs:',
				'  dispatch:',
				'    runs-on: ubuntu-latest',
				'    permissions: {actions: write}',
				'    steps:',
				'      - uses: actions/checkout@v7',
				'  dispatch2:',
				'    runs-on: ubuntu-latest',
				'    permissions: {actions: write}',
				'    steps:',
				'      - uses: ./.github/actions/dorfl-setup',
				'  fine:',
				'    runs-on: ubuntu-latest',
				'    permissions: {actions: write}',
				'    steps:',
				'      - run: gh workflow run x.yml',
			].join('\n'),
		);
		expect(v.map((x) => `${x.job}:${x.rule}`)).toEqual([
			'dispatch:actions-write-with-code',
			'dispatch2:actions-write-with-code',
		]);
	});

	it('a workflow-level concurrency in dorfl-item.yml; a phase job off a hosted label', () => {
		const v = guardOne(
			[
				'on: {workflow_call: {}}',
				'permissions: {}',
				'concurrency: {group: x}',
				'jobs:',
				'  lock:',
				'    runs-on: [self-hosted, linux]',
				'    permissions: {contents: write}',
				'    steps:',
				'      - run: dorfl advance x --phase lock',
			].join('\n'),
			[],
			'workflows/dorfl-item.yml',
		);
		expect(v.map((x) => x.rule)).toEqual([
			'item-workflow-concurrency',
			'phase-job-not-hosted',
		]);
	});

	it('a called job requesting a scope its caller does not grant; the cap also applies to the rules', () => {
		const called: GuardFile = {
			path: 'workflows/dorfl-item.yml',
			content: [
				'on: {workflow_call: {}}',
				'permissions: {}',
				'jobs:',
				'  apply:',
				'    runs-on: ubuntu-latest',
				'    permissions: {contents: write, checks: read}',
				'    steps:',
				'      - run: dorfl advance x --phase apply',
			].join('\n'),
		};
		const v = guardOne(
			[
				'permissions: {}',
				'jobs:',
				'  item:',
				'    permissions: {contents: write}',
				'    uses: ./.github/workflows/dorfl-item.yml',
			].join('\n'),
			[called],
		);
		expect(v.map((x) => `${x.job}:${x.rule}:${x.detail}`)).toEqual([
			'item -> workflows/dorfl-item.yml:apply:caller-does-not-grant:requests checks: read, its caller grants none',
		]);
	});
});

describe('the workflow guard over everything install-ci generates, and this repository', () => {
	it('every generated workflow and composite action passes, for every config shape', async () => {
		const all: string[] = [];
		for (const {name, config, files} of await generated()) {
			expect(files.some((f) => f.path === 'workflows/intake.yml')).toBe(true);
			for (const v of guardWorkflows(files, {
				providerKeys: providerKeys(config),
			})) {
				all.push(`[${name}] ${fmt([v])[0]}`);
			}
		}
		expect(all).toEqual([]);
	});

	it('no generated artifact carries the removed auth-json mode (PI_AUTH_JSON, the auth.json step, the OAuth refresh script, a GH_PAT)', async () => {
		const caps = await loadCapabilityRegistry();
		const hits: string[] = [];
		for (const {name, config, hook} of CONFIGS) {
			for (const f of buildSetupArtifacts(config, caps, {
				projectSetupSteps: hook,
			})) {
				for (const needle of [
					'PI_AUTH_JSON',
					'auth.json',
					'refresh-oauth-token',
					'Refresh OAuth token',
					'GH_PAT',
				]) {
					if (f.content.includes(needle) || f.path.includes(needle)) {
						hits.push(`[${name}] ${f.path}: ${needle}`);
					}
				}
			}
		}
		expect(hits).toEqual([]);
	});

	it("this repository's checked-in .github/workflows and composite actions pass", () => {
		const files = checkedIn();
		expect(files.some((f) => f.path === 'workflows/verify.yml')).toBe(true);
		expect(
			fmt(guardWorkflows(files, {providerKeys: checkedInProviderKeys(files)})),
		).toEqual([]);
	});
});
