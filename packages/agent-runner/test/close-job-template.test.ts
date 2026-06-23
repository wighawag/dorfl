import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	rmSync,
	existsSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';
import {
	type ResolvedCIConfig,
	loadCapabilityRegistry,
} from '../src/install-ci-core.js';
import {MemoryCIProviderContext} from '../src/install-ci-github.js';
import {installCI} from '../src/install-ci.js';
import {
	CLOSE_JOB_CAPABILITY_ID,
	CLOSE_JOB_WORKFLOW_PATH,
	generateCloseJobWorkflow,
	validateCloseJobWorkflow,
} from '../src/close-job-template.js';

/**
 * `install-ci-close-job-workflow` — capability E (close issues when their work
 * lands). TRIGGER: a merge to main via `push: {branches: [main]}` (fires for a
 * PR-merge AND a direct push, ALWAYS with a token that can close issues; a fork
 * `pull_request` event's read-only token could not — see the task's Decisions).
 *
 * SEAMS: the workflow is generated into the `--fake` scratch dir with a STUBBED
 * `GitHubCIContext` ({@link MemoryCIProviderContext}: `setSecret` records to
 * memory, `ghAvailable=false`, `repo` a fixture) — NO network, NO real `gh`, NO
 * real GitHub. The produced YAML is structurally validated (the merge-to-main
 * trigger + the invoked close machinery), and shared-write isolation (real
 * `.github/` + real secrets untouched) is pinned. The query's own behaviour is
 * already covered by `brief-complete-query` and is NOT re-tested here.
 */

const config: ResolvedCIConfig = {
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
};

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'close-job-'));
});
afterEach(() => {
	rmSync(work, {recursive: true, force: true});
});

// ─── the generated workflow satisfies every structural invariant ─────────────

describe('the close-job workflow satisfies every structural invariant', () => {
	it('the shipped emitter output passes validation cleanly', () => {
		const text = generateCloseJobWorkflow(config);
		const result = validateCloseJobWorkflow(text);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('is deterministic — the same config produces byte-identical output', () => {
		expect(generateCloseJobWorkflow(config)).toBe(
			generateCloseJobWorkflow(config),
		);
	});

	it('TRIGGER: a merge to main via `push: {branches: [main]}`, NOT `pull_request`', () => {
		const text = generateCloseJobWorkflow(config);
		expect(
			/\bon:\s*[\s\S]*?push:\s*[\s\S]*?branches:\s*[\s\S]*?-\s*main\b/.test(
				text,
			),
		).toBe(true);
		// NOT the pull_request trigger (a fork PR's token is read-only and cannot
		// close; there is no native "PR merged" event). Scoped to operative lines.
		const result = validateCloseJobWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'not-pull-request-trigger',
		);
		// And NOT the build/task tick's cron/dispatch drain shape.
		expect(result.problems.map((p) => p.id)).not.toContain('no-cron-trigger');
		expect(/work\/questions\//.test(text)).toBe(false);
	});

	it('invokes `agent-runner close-merged-issues` (consumes the unchanged resolution + query + close)', () => {
		const text = generateCloseJobWorkflow(config);
		expect(/agent-runner close-merged-issues\b/.test(text)).toBe(true);
		// It must NOT re-implement the close with a direct `gh issue close`, and must
		// NOT invoke a build/task/intake verb (CI owns only the close job + trigger).
		const result = validateCloseJobWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'no-direct-gh-issue-close',
		);
		expect(result.problems.map((p) => p.id)).not.toContain('no-build-verbs');
	});

	it('runs IN-PLACE (no --isolated/--remote) and carries a concurrency group', () => {
		const text = generateCloseJobWorkflow(config);
		const result = validateCloseJobWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain('no-isolated-flag');
		expect(result.problems.map((p) => p.id)).not.toContain('no-remote-flag');
		expect(/\bconcurrency:\s*[\s\S]*?group:/.test(text)).toBe(true);
	});

	it('US #9: requests NO `workflows` permission and no step touches the workflows tree; DOES request issues: write', () => {
		const text = generateCloseJobWorkflow(config);
		expect(/\bworkflows:\s*write\b/.test(text)).toBe(false);
		// It needs `issues: write` (to close with the merge-to-main token).
		expect(/\bissues:\s*write\b/.test(text)).toBe(true);
		const result = validateCloseJobWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'never-edits-dot-github-workflows',
		);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'no-workflows-permission',
		);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'issues-write-permission',
		);
	});
});

// ─── the validator FLAGS a workflow missing each invariant ───────────────────

describe('validateCloseJobWorkflow flags a workflow missing each invariant', () => {
	const base = generateCloseJobWorkflow(config);

	const expectFlagged = (broken: string, id: string): void => {
		const result = validateCloseJobWorkflow(broken);
		expect(result.ok).toBe(false);
		expect(result.problems.map((p) => p.id)).toContain(id);
	};

	it('flags a missing push-to-main trigger', () => {
		expectFlagged(
			base.replace(/  push:\n    branches:\n      - main\n/, '  push: {}\n'),
			'trigger-push-main',
		);
	});

	it('flags the pull_request trigger leaking in (fork read-only token cannot close)', () => {
		expectFlagged(
			base.replace(
				/  push:\n    branches:\n      - main\n/,
				'  pull_request:\n    types: [closed]\n',
			),
			'not-pull-request-trigger',
		);
	});

	it('flags a cron trigger (the close-job is merge-triggered, not a drain)', () => {
		expectFlagged(
			base.replace(
				/  push:\n    branches:\n      - main\n/,
				"  schedule:\n    - cron: '0 * * * *'\n",
			),
			'no-cron-trigger',
		);
	});

	it('flags a missing `agent-runner close-merged-issues` invocation', () => {
		expectFlagged(
			base.replace(
				/run: agent-runner close-merged-issues/,
				'run: echo nothing',
			),
			'invokes-close-merged-issues',
		);
	});

	it('flags a direct `gh issue close` (must go through the provider seam)', () => {
		expectFlagged(
			base.replace(
				/run: agent-runner close-merged-issues/,
				'run: gh issue close 42',
			),
			'no-direct-gh-issue-close',
		);
	});

	it('flags a build/task/intake verb sneaking in (close-job only closes)', () => {
		expectFlagged(
			base.replace(
				/run: agent-runner close-merged-issues/,
				'run: agent-runner advance -n 10 --merge',
			),
			'no-build-verbs',
		);
	});

	it('flags an --isolated flag (CI runs in-place)', () => {
		expectFlagged(
			base.replace(
				/run: agent-runner close-merged-issues/,
				'run: agent-runner close-merged-issues --isolated',
			),
			'no-isolated-flag',
		);
	});

	it('flags a missing concurrency group', () => {
		expectFlagged(
			base.replace(/concurrency:\s*\n\s*group:[^\n]*/, '# concurrency removed'),
			'concurrency-group',
		);
	});

	it('flags a `workflows: write` permission (US #9)', () => {
		expectFlagged(
			base.replace(/permissions:\n/, 'permissions:\n  workflows: write\n'),
			'no-workflows-permission',
		);
	});

	it('flags a step touching .github/workflows/** (US #9)', () => {
		expectFlagged(
			base.replace(
				/run: agent-runner close-merged-issues/,
				'run: cp x .github/workflows/evil.yml',
			),
			'never-edits-dot-github-workflows',
		);
	});

	it('flags a missing issues: write permission (cannot close)', () => {
		expectFlagged(
			base.replace(/  issues: write\n/, ''),
			'issues-write-permission',
		);
	});
});

// ─── emitted via the registry + --fake seam (no network, no real GitHub) ─────

describe('the capability self-registers and emits through installCI --fake', () => {
	it('loadCapabilityRegistry picks up the close-job module (no shared-list edit)', async () => {
		const caps = await loadCapabilityRegistry();
		expect(caps.map((c) => c.id)).toContain(CLOSE_JOB_CAPABILITY_ID);
	});

	it('installCI --fake writes the workflow under .fake/, never the real .github/, and sets NO real secret', async () => {
		const caps = await loadCapabilityRegistry();
		const closeJob = caps.find((c) => c.id === CLOSE_JOB_CAPABILITY_ID)!;
		expect(closeJob).toBeDefined();

		// Snapshot global state BEFORE the run (shared-write isolation).
		const home = homedir();
		const homeBefore = safeList(home);
		const cwdGithubBefore = existsSync(join(process.cwd(), '.github'));

		const ctx = new MemoryCIProviderContext({
			workDir: work,
			repo: 'owner/repo',
			ghAvailable: false,
		});
		const file = join(work, 'ci.json');
		writeConfigFile(file);

		const result = await installCI({
			ctx,
			fake: true,
			configFile: file,
			capabilities: [closeJob],
			log: () => {},
		});

		// The workflow was written under .fake/, NEVER the real .github/.
		const fakePath = join(work, '.fake', CLOSE_JOB_WORKFLOW_PATH);
		expect(existsSync(fakePath)).toBe(true);
		expect(existsSync(join(work, '.github'))).toBe(false);
		expect(result.written).toContain(join('.fake', CLOSE_JOB_WORKFLOW_PATH));

		// The produced YAML structurally validates.
		const text = readFileSync(fakePath, 'utf8');
		expect(validateCloseJobWorkflow(text).ok).toBe(true);

		// Shared-write isolation: NO real secret set, real .github/ + ~ untouched,
		// and the stubbed close seam recorded NO real issue close (none called here).
		expect(ctx.secrets.size).toBe(0);
		expect(result.secrets).toEqual([]);
		expect(safeList(home)).toEqual(homeBefore);
		expect(existsSync(join(process.cwd(), '.github'))).toBe(cwdGithubBefore);
		expect(existsSync(join(process.cwd(), '.fake'))).toBe(false);
	});
});

function writeConfigFile(file: string): void {
	writeFileSync(
		file,
		JSON.stringify({
			authMode: 'models-json',
			providers: [
				{
					name: 'anthropic',
					apiKeyEnvVar: 'ANTHROPIC_API_KEY',
					models: [{id: 'm'}],
					builtin: true,
				},
			],
			defaultProvider: 'anthropic',
			defaultModel: 'm',
		}),
	);
}

/** A stable directory listing (sorted), or [] if the dir is missing. */
function safeList(dir: string): string[] {
	try {
		return readdirSync(dir).sort();
	} catch {
		return [];
	}
}
