import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {
	buildSetupArtifacts,
	dorflPackageVersion,
	loadCapabilityRegistry,
	PI_HARNESS_PACKAGE,
	PI_HARNESS_VERSION,
	type ResolvedCIConfig,
} from '../src/install-ci-core.js';

/**
 * GitHub Actions SCRIPT INJECTION guard for everything `dorfl install-ci`
 * generates. A `${{ }}` expression inside a `run:` value is substituted as TEXT
 * before the shell starts, so its value becomes part of the script instead of
 * data the script reads (GitHub's "Secure use" guidance). The rule the
 * generators follow: every value reaches the shell through a step-level `env:`
 * mapping and is read back as a quoted variable (`"${VAR}"`). No exceptions, so
 * the rule is checkable mechanically.
 *
 * The check PARSES the YAML (no regex over the text) and walks every mapping:
 * any key named `run` whose value is a string containing `${{` is a violation.
 * That covers workflow steps (`jobs.<id>.steps[].run`) and composite-action
 * steps (`runs.steps[].run`) alike, and it is not fooled by `${{` in comments
 * (the parser drops them) or in `env:` / `with:` / `if:` values (allowed).
 */

/** A `run:` value that splices a `${{ }}` expression into the script. */
interface Violation {
	file: string;
	path: string;
	run: string;
}

/** Walk a parsed YAML document, collecting every `run:` string containing `${{`. */
function findExpressionsInRun(file: string, doc: unknown): Violation[] {
	const out: Violation[] = [];
	const walk = (node: unknown, path: string): void => {
		if (Array.isArray(node)) {
			node.forEach((child, i) => walk(child, `${path}[${i}]`));
			return;
		}
		if (node !== null && typeof node === 'object') {
			for (const [key, value] of Object.entries(node)) {
				const childPath = path === '' ? key : `${path}.${key}`;
				if (
					key === 'run' &&
					typeof value === 'string' &&
					value.includes('${{')
				) {
					out.push({file, path: childPath, run: value});
				}
				walk(value, childPath);
			}
		}
	};
	walk(doc, '');
	return out;
}

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

/**
 * Every config shape that changes what the generators emit: both auth modes,
 * both install sources, and every repo visibility (public adds
 * `persist-credentials: false`), plus a project-setup hook fragment.
 */
const CONFIGS: {name: string; config: ResolvedCIConfig; hook?: string}[] = [
	{name: 'models-json/registry', config: BASE},
	{
		name: 'models-json/workspace',
		config: {...BASE, installSource: 'workspace'},
	},
	{
		name: 'auth-json/registry',
		config: {...BASE, authMode: 'auth-json', providers: []},
	},
	{name: 'public', config: {...BASE, repoVisibility: 'public'}},
	{name: 'private', config: {...BASE, repoVisibility: 'private'}},
	{name: 'internal', config: {...BASE, repoVisibility: 'internal'}},
	{
		name: 'with project-setup hook',
		config: BASE,
		hook:
			'    - name: Install project deps\n' +
			'      shell: bash\n' +
			'      run: pnpm install --frozen-lockfile --ignore-scripts\n',
	},
];

async function generateEverything(): Promise<
	{file: string; content: string}[]
> {
	const caps = await loadCapabilityRegistry();
	const out: {file: string; content: string}[] = [];
	for (const {name, config, hook} of CONFIGS) {
		for (const f of buildSetupArtifacts(config, caps, {
			projectSetupSteps: hook,
		})) {
			if (/\.ya?ml$/.test(f.path)) {
				out.push({file: `${name}: ${f.path}`, content: f.content});
			}
		}
	}
	return out;
}

describe('install-ci: no `${{ }}` expression inside any generated `run:` (script-injection guard)', () => {
	it('the checker itself flags a spliced expression and ignores env/if/comments', () => {
		// Pin the checker: it must catch the old pattern, and must NOT flag the
		// sanctioned env-routed pattern (nor `${{` in `if:` / `env:` / comments).
		const bad = parse(
			[
				'jobs:',
				'  j:',
				'    steps:',
				'      - run: dorfl advance "${{ matrix.item }}" --propose',
			].join('\n'),
		);
		expect(findExpressionsInRun('bad', bad)).toHaveLength(1);
		const good = parse(
			[
				'jobs:',
				'  j:',
				"    if: ${{ github.event_name == 'workflow_dispatch' }}",
				'    steps:',
				'      # a comment mentioning ${{ matrix.item }} is fine',
				'      - env:',
				'          WORK_ITEM: ${{ matrix.item }}',
				'        run: dorfl advance "${WORK_ITEM}" --propose',
			].join('\n'),
		);
		expect(findExpressionsInRun('good', good)).toEqual([]);
	});

	it('covers every generated workflow + the composite setup action', async () => {
		const files = await generateEverything();
		const paths = new Set(files.map((f) => f.file.replace(/^[^:]*: /, '')));
		// Guard against the walk silently checking nothing: every capability
		// workflow and the composite action must be in the set.
		for (const expected of [
			join('actions', 'dorfl-setup', 'action.yml'),
			'workflows/advance-lifecycle.yml',
			'workflows/intake.yml',
			'workflows/close-job.yml',
			'workflows/verify.yml',
		]) {
			expect(paths.has(expected)).toBe(true);
		}
	});

	it('no generated `run:` value contains `${{`', async () => {
		const violations: Violation[] = [];
		for (const {file, content} of await generateEverything()) {
			violations.push(...findExpressionsInRun(file, parse(content)));
		}
		expect(violations).toEqual([]);
	});

	it('the seed template docs/ci/advance-loop.yml.template follows the same rule', () => {
		const here = dirname(fileURLToPath(import.meta.url));
		const seed = readFileSync(
			join(here, '..', '..', '..', 'docs', 'ci', 'advance-loop.yml.template'),
			'utf8',
		);
		expect(
			findExpressionsInRun('advance-loop.yml.template', parse(seed)),
		).toEqual([]);
	});
});

describe('install-ci: the composite setup action pins its global installs', () => {
	it('installs dorfl at the version of the dorfl that generated it, and pi at the declared version', () => {
		const pkg = JSON.parse(
			readFileSync(
				join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
				'utf8',
			),
		) as {version: string};
		expect(dorflPackageVersion()).toBe(pkg.version);
		const [action] = buildSetupArtifacts(BASE);
		const runs = (
			parse(action.content) as {runs: {steps: {run?: string}[]}}
		).runs.steps
			.map((s) => s.run)
			.filter((r): r is string => typeof r === 'string');
		expect(runs).toContain(`npm install -g dorfl@${pkg.version}`);
		expect(runs).toContain(
			`npm install -g ${PI_HARNESS_PACKAGE}@${PI_HARNESS_VERSION}`,
		);
		// No unpinned global install of either package anywhere.
		for (const r of runs) {
			expect(r).not.toMatch(/npm install -g dorfl(?!@)/);
			expect(r).not.toMatch(/pi-coding-agent(?!@)/);
		}
	});
});
