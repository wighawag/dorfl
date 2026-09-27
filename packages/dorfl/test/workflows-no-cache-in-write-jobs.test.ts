import {describe, it, expect} from 'vitest';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';

/**
 * CACHE-POISONING guard for this repository's OWN checked-in workflows (ADR
 * `ci-agent-job-holds-no-write-token`, decision 12; task
 * `release-workflow-restores-no-cache`).
 *
 * The Actions cache is shared per branch scope: an entry written on the default
 * branch is restored by every later job on it. The CI agents dorfl runs (intake,
 * advance) run in default-branch jobs, and an agent with a shell can reach its
 * job's `ACTIONS_RUNTIME_TOKEN` (a parent process's `/proc/<pid>/environ`, or
 * `sudo` on a hosted runner) and write a cache entry under the key another job
 * will look up. So a job that holds a write permission or `id-token: write`
 * (npm trusted publishing, Pages deploy) must NOT restore an Actions cache: it
 * would run agent-controlled bytes with that identity.
 *
 * A job "restores a cache" when one of its steps (or a step of a LOCAL composite
 * action it `uses: ./...`) is:
 *  - `actions/cache` or `actions/cache/restore` (any ref);
 *  - any action with a non-empty, non-false `cache` input (`setup-node`'s
 *    `cache: pnpm`, and the same-named input of the other `setup-*` actions);
 *  - `actions/setup-node` at a ref other than an explicit `@v1`..`@v4` tag
 *    WITHOUT `package-manager-cache: false`: since v5 setup-node turns caching
 *    on by itself from package.json's `packageManager`, so dropping `cache:`
 *    alone is not enough (a SHA pin carries no readable major, so it must say
 *    so explicitly too).
 *
 * The effective permissions are the job's `permissions`, else the workflow's.
 * When neither sets them the job gets the repository's default token, which may
 * be read-write, so it counts as write-holding.
 */

interface Violation {
	file: string;
	job: string;
	step: string;
	reason: string;
}

type Step = Record<string, unknown>;

/** Does this (effective) `permissions` value grant any write or `id-token: write`? */
function holdsWrite(permissions: unknown): boolean {
	if (permissions === undefined || permissions === null) return true;
	if (typeof permissions === 'string') return permissions !== 'read-all';
	if (typeof permissions === 'object') {
		return Object.values(permissions as Record<string, unknown>).some(
			(v) => v === 'write',
		);
	}
	return true;
}

/** Strip the ref: `actions/setup-node@v5` -> `actions/setup-node`. */
function actionName(uses: string): string {
	const at = uses.indexOf('@');
	return (at < 0 ? uses : uses.slice(0, at)).toLowerCase();
}

function actionRef(uses: string): string {
	const at = uses.indexOf('@');
	return at < 0 ? '' : uses.slice(at + 1);
}

/** Why this single step restores a cache, or undefined if it does not. */
function cacheRestoreReason(step: Step): string | undefined {
	const uses = typeof step.uses === 'string' ? step.uses : undefined;
	if (uses === undefined) return undefined;
	const name = actionName(uses);
	const withInputs =
		step.with !== null && typeof step.with === 'object'
			? (step.with as Record<string, unknown>)
			: {};
	if (name === 'actions/cache' || name === 'actions/cache/restore') {
		return `uses ${uses}`;
	}
	const cache = withInputs.cache;
	if (
		cache !== undefined &&
		cache !== null &&
		cache !== false &&
		String(cache).trim() !== '' &&
		String(cache).trim() !== 'false'
	) {
		return `${uses} with cache: ${String(cache)}`;
	}
	if (name === 'actions/setup-node') {
		const pre5 = /^v[1-4](\.|$)/.test(actionRef(uses));
		const pmc = withInputs['package-manager-cache'];
		if (!pre5 && pmc !== false && String(pmc) !== 'false') {
			return `${uses} without package-manager-cache: false (setup-node v5+ caches automatically)`;
		}
	}
	return undefined;
}

/** Steps of a local composite action (`uses: ./path`), resolved from the repo root. */
function localCompositeSteps(repoRoot: string, uses: string): Step[] {
	const dir = join(repoRoot, uses);
	for (const f of ['action.yml', 'action.yaml']) {
		const p = join(dir, f);
		if (existsSync(p)) {
			const doc = parse(readFileSync(p, 'utf8')) as {
				runs?: {steps?: Step[]};
			};
			return doc?.runs?.steps ?? [];
		}
	}
	return [];
}

/** Every cache restore in a write-holding job of one parsed workflow. */
function findCacheRestoresInWriteJobs(
	file: string,
	doc: unknown,
	repoRoot?: string,
): Violation[] {
	const out: Violation[] = [];
	const wf = (doc ?? {}) as {
		permissions?: unknown;
		jobs?: Record<string, {permissions?: unknown; steps?: Step[]}>;
	};
	for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
		const effective =
			job && 'permissions' in job ? job.permissions : wf.permissions;
		if (!holdsWrite(effective)) continue;
		const visit = (steps: Step[], prefix: string, depth: number): void => {
			steps.forEach((step, i) => {
				const label = `${prefix}steps[${i}]${
					typeof step.name === 'string' ? ` (${step.name})` : ''
				}`;
				const reason = cacheRestoreReason(step);
				if (reason) out.push({file, job: jobId, step: label, reason});
				if (
					repoRoot !== undefined &&
					depth < 5 &&
					typeof step.uses === 'string' &&
					step.uses.startsWith('./')
				) {
					visit(
						localCompositeSteps(repoRoot, step.uses),
						`${label} -> ${step.uses}: `,
						depth + 1,
					);
				}
			});
		};
		visit(job?.steps ?? [], '', 0);
	}
	return out;
}

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..', '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');

function repoWorkflows(): {file: string; content: string}[] {
	return readdirSync(WORKFLOWS_DIR)
		.filter((f) => /\.ya?ml$/.test(f))
		.sort()
		.map((f) => ({
			file: f,
			content: readFileSync(join(WORKFLOWS_DIR, f), 'utf8'),
		}));
}

describe("this repo's workflows: no Actions cache restore in a job holding write or id-token (cache-poisoning guard)", () => {
	it('the checker flags cache restores in write-holding jobs only', () => {
		const bad = parse(
			[
				'permissions:',
				'  contents: write',
				'  id-token: write',
				'jobs:',
				'  release:',
				'    steps:',
				'      - uses: actions/setup-node@v4',
				'        with:',
				'          cache: pnpm',
				'      - uses: actions/cache@v4',
				'      - uses: actions/cache/restore@v4',
				'      - uses: actions/setup-node@v5',
				'      - uses: actions/setup-node@0123456789abcdef',
				'        with:',
				'          package-manager-cache: true',
				'      - uses: actions/setup-python@v5',
				'        with:',
				'          cache: pip',
			].join('\n'),
		);
		expect(findCacheRestoresInWriteJobs('bad', bad)).toHaveLength(6);

		const good = parse(
			[
				'permissions:',
				'  contents: write',
				'jobs:',
				'  release:',
				'    steps:',
				'      - uses: actions/setup-node@v4',
				'      - uses: actions/setup-node@v5',
				'        with:',
				'          package-manager-cache: false',
				'      - uses: actions/setup-node@abcdef0123',
				'        with:',
				'          cache: ""',
				'          package-manager-cache: false',
				'      - run: pnpm install --frozen-lockfile',
				// Job-level permissions override the workflow's: a read-only
				// job may restore a cache.
				'  verify:',
				'    permissions:',
				'      contents: read',
				'    steps:',
				'      - uses: actions/setup-node@v4',
				'        with:',
				'          cache: pnpm',
				'  readall:',
				'    permissions: read-all',
				'    steps:',
				'      - uses: actions/cache@v4',
			].join('\n'),
		);
		expect(findCacheRestoresInWriteJobs('good', good)).toEqual([]);
	});

	it('effective permissions: job overrides workflow; unset counts as write', () => {
		expect(holdsWrite(undefined)).toBe(true);
		expect(holdsWrite('write-all')).toBe(true);
		expect(holdsWrite('read-all')).toBe(false);
		expect(holdsWrite({contents: 'read'})).toBe(false);
		expect(holdsWrite({})).toBe(false);
		expect(holdsWrite({'id-token': 'write'})).toBe(true);
		expect(holdsWrite({pages: 'write', contents: 'read'})).toBe(true);

		const jobOverride = parse(
			[
				'permissions:',
				'  contents: read',
				'jobs:',
				'  publish:',
				'    permissions:',
				'      id-token: write',
				'    steps:',
				'      - uses: actions/cache@v4',
			].join('\n'),
		);
		expect(findCacheRestoresInWriteJobs('x', jobOverride)).toHaveLength(1);
	});

	it('reads a non-empty set of workflows, including release.yml', () => {
		const files = repoWorkflows().map((w) => w.file);
		expect(files).toContain('release.yml');
		expect(files).toContain('deploy-gh-pages.yml');
	});

	it('no checked-in workflow restores a cache in a write-holding job', () => {
		const violations: Violation[] = [];
		for (const {file, content} of repoWorkflows()) {
			violations.push(
				...findCacheRestoresInWriteJobs(file, parse(content), REPO_ROOT),
			);
		}
		expect(violations).toEqual([]);
	});
});
