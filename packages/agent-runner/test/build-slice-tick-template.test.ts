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
	BUILD_SLICE_TICK_CAPABILITY_ID,
	BUILD_SLICE_TICK_WORKFLOW_PATH,
	generateBuildSliceTickWorkflow,
	validateBuildSliceTickWorkflow,
} from '../src/build-slice-tick-template.js';

/**
 * `install-ci-build-slice-tick-workflow` — capabilities A (auto-build ready
 * slices) + B (auto-slice ready PRDs). CI ALWAYS invokes `advance` (a strict
 * superset of `do`; with the lifecycle gates calm it degrades to `do`'s
 * build/slice behaviour — ADR ci-config-policy-and-gate-family §1); the verb is
 * never a user decision.
 *
 * SEAMS: the workflow is generated into the `--fake` scratch dir with a STUBBED
 * `GitHubCIContext` ({@link MemoryCIProviderContext}: `setSecret` records to
 * memory, `ghAvailable=false`, `repo` a fixture) — NO network, NO real `gh`, NO
 * real GitHub. The produced YAML is structurally validated (reusing the
 * snapshot-assertion style of `advance-ci-template.ts`); the matrix/sequential
 * split, the `integrationMode`-drives-both wiring, the `AGENT_RUNNER_*` env block,
 * the concurrency group, and the US #9 self-edit prohibition are asserted; and
 * shared-write isolation (real `.github/` + real secrets untouched) is pinned.
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
	work = mkdtempSync(join(tmpdir(), 'build-slice-tick-'));
});
afterEach(() => {
	rmSync(work, {recursive: true, force: true});
});

// ─── the generated workflow satisfies every structural invariant ─────────────

describe('the build/slice-tick workflow satisfies every structural invariant', () => {
	it('the shipped emitter output passes validation cleanly', () => {
		const text = generateBuildSliceTickWorkflow(config);
		const result = validateBuildSliceTickWorkflow(text);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('is deterministic — the same config produces byte-identical output', () => {
		expect(generateBuildSliceTickWorkflow(config)).toBe(
			generateBuildSliceTickWorkflow(config),
		);
	});

	it('CI ALWAYS invokes `advance`, NEVER `do` (the verb is not a user decision)', () => {
		const text = generateBuildSliceTickWorkflow(config);
		expect(/agent-runner advance\b/.test(text)).toBe(true);
		expect(/agent-runner do\b/.test(text)).toBe(false);
	});

	it('triggers on cron + workflow_dispatch (with an integrationMode input), NOT the answer-loop push', () => {
		const text = generateBuildSliceTickWorkflow(config);
		expect(/\bschedule:\s*[\s\S]*?-\s*cron:/.test(text)).toBe(true);
		expect(/\bworkflow_dispatch:/.test(text)).toBe(true);
		expect(
			/workflow_dispatch:[\s\S]*?inputs:[\s\S]*?integrationMode:/.test(text),
		).toBe(true);
		// The on-answer-committed push trigger belongs to the SIBLING
		// advance-lifecycle slice, not the build/slice tick.
		expect(/work\/questions\//.test(text)).toBe(false);
	});

	it('propose ⇒ a DYNAMIC matrix enumerated via `scan --json`, one `advance --propose` per item', () => {
		const text = generateBuildSliceTickWorkflow(config);
		expect(/strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(true);
		expect(text).toContain('agent-runner scan --json');
		expect(/agent-runner advance "?\$\{\{\s*matrix\./.test(text)).toBe(true);
		// The leg carries `--propose` (tying integration mode to the matrix shape);
		// `--merge` never rides a matrix leg (parallel merge-to-main thrash).
		expect(
			/advance-propose:[\s\S]*?agent-runner advance "?\$\{\{\s*matrix\.[\s\S]*?--propose\b/.test(
				text,
			),
		).toBe(true);
		expect(
			/agent-runner advance "?\$\{\{\s*matrix\.[^\n]*--merge\b/.test(text),
		).toBe(false);
	});

	it('merge ⇒ a SINGLE SEQUENTIAL `advance -n <x> --merge` (no matrix)', () => {
		const text = generateBuildSliceTickWorkflow(config);
		expect(/agent-runner advance -n\b/.test(text)).toBe(true);
		expect(/agent-runner advance -n\b[^\n]*--merge\b/.test(text)).toBe(true);
		expect(/advance-merge:[\s\S]*?strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(
			false,
		);
	});

	it('ONE word `integrationMode` drives BOTH the flag and the derived job shape', () => {
		const text = generateBuildSliceTickWorkflow(config);
		expect(text).toContain('integrationMode:');
		expect(/github\.event\.inputs\.integrationMode/.test(text)).toBe(true);
		// The same value gates BOTH the propose and merge jobs' `if:` (the shape),
		// and selects the `--propose`/`--merge` flag (no second knob to desync).
		expect(
			text.includes(
				"if: ${{ (github.event.inputs.integrationMode || 'propose') == 'propose' }}",
			),
		).toBe(true);
		expect(
			text.includes(
				"if: ${{ (github.event.inputs.integrationMode || 'propose') == 'merge' }}",
			),
		).toBe(true);
	});

	it('exposes the gate family via the AGENT_RUNNER_* env block at calm defaults (build/slice-only)', () => {
		const text = generateBuildSliceTickWorkflow(config);
		expect(/AGENT_RUNNER_AUTO_BUILD:/.test(text)).toBe(true);
		expect(/AGENT_RUNNER_AUTO_SLICE:/.test(text)).toBe(true);
		// The two question-gates sit at their calm defaults → no questions out of box.
		expect(/AGENT_RUNNER_OBSERVATION_TRIAGE:\s*'off'/.test(text)).toBe(true);
		expect(/AGENT_RUNNER_SURFACE_BLOCKERS:\s*'false'/.test(text)).toBe(true);
		// No `autoAdvance` gate (the lifecycle decomposes into the gate family).
		expect(/AGENT_RUNNER_AUTO_ADVANCE\b/.test(text)).toBe(false);
		// No `autoAdvance` gate on any operative line (the safety comment may name it).
		expect(
			validateBuildSliceTickWorkflow(text).problems.map((p) => p.id),
		).not.toContain('no-auto-advance-gate');
	});

	it('runs IN-PLACE (no --isolated/--remote on any invocation) and carries a concurrency group', () => {
		const text = generateBuildSliceTickWorkflow(config);
		// The prohibition is on the job's INVOCATIONS, not explanatory comments — so
		// assert via the validator (which scopes the negative checks to operative,
		// non-comment lines). A `run:` carrying `--isolated`/`--remote` would fail it.
		const result = validateBuildSliceTickWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain('no-isolated-flag');
		expect(result.problems.map((p) => p.id)).not.toContain('no-remote-flag');
		expect(/\bconcurrency:\s*[\s\S]*?group:/.test(text)).toBe(true);
	});

	it('the fully-autonomous-to-main path is a loud, NON-DEFAULT opt-in (default is propose)', () => {
		const text = generateBuildSliceTickWorkflow(config);
		// The default integration mode is `propose` (one PR per item, a human
		// merges); reaching merge-to-main requires deliberately picking `merge`.
		expect(/default:\s*'propose'/.test(text)).toBe(true);
		expect(
			text.includes("github.event.inputs.integrationMode || 'propose'"),
		).toBe(true);
	});

	it('uses explicit slug prefixes (slice:/prd:), never bare', () => {
		const text = generateBuildSliceTickWorkflow(config);
		expect(text).toContain('"slice:" + .slug');
	});

	it('US #9: requests NO `workflows` permission and no job step touches the workflows tree', () => {
		const text = generateBuildSliceTickWorkflow(config);
		expect(/\bworkflows:\s*write\b/.test(text)).toBe(false);
		// No emitted job STEP touches the workflows tree (cannot self-edit triggers).
		// Scoped to operative lines via the validator — the safety comment mentions
		// the prohibition without being a violation of it.
		const result = validateBuildSliceTickWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'never-edits-dot-github-workflows',
		);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'no-workflows-permission',
		);
	});
});

// ─── the validator FLAGS a workflow missing each invariant ───────────────────

describe('validateBuildSliceTickWorkflow flags a workflow missing each invariant', () => {
	const base = generateBuildSliceTickWorkflow(config);

	const expectFlagged = (broken: string, id: string): void => {
		const result = validateBuildSliceTickWorkflow(broken);
		expect(result.ok).toBe(false);
		expect(result.problems.map((p) => p.id)).toContain(id);
	};

	it('flags invoking `do` directly', () => {
		expectFlagged(
			base.replace(
				/agent-runner advance -n 10 --merge/,
				'agent-runner do -n 10 --merge',
			),
			'never-invokes-do',
		);
	});

	it('flags a missing cron trigger', () => {
		expectFlagged(
			base.replace(/-\s*cron:.*$/m, '# (cron removed)'),
			'trigger-cron',
		);
	});

	it('flags a missing workflow_dispatch trigger', () => {
		expectFlagged(
			base.replace(/\bworkflow_dispatch:/g, '# dispatch-removed:'),
			'trigger-workflow-dispatch',
		);
	});

	it('flags the answer-loop push trigger leaking in (sibling-slice concern)', () => {
		const broken = base.replace(
			/concurrency:/,
			"# leaked answer-loop trigger\n#   paths:\n#     - 'work/questions/**'\nconcurrency:",
		);
		expectFlagged(broken, 'no-answer-loop-push-trigger');
	});

	it('flags a propose matrix leg missing the --propose flag', () => {
		expectFlagged(
			base.replace(
				/(agent-runner advance "\$\{\{ matrix\.item \}\}") --propose/,
				'$1',
			),
			'propose-leg-carries-propose-flag',
		);
	});

	it('flags a merge -n job missing the --merge flag', () => {
		expectFlagged(
			base.replace(/(agent-runner advance -n 10) --merge/, '$1'),
			'merge-job-carries-merge-flag',
		);
	});

	it('flags --merge riding a matrix leg (parallel merge-to-main thrash)', () => {
		expectFlagged(
			base.replace(
				/(agent-runner advance "\$\{\{ matrix\.item \}\}") --propose/,
				'$1 --merge',
			),
			'merge-flag-not-on-matrix-leg',
		);
	});

	it('flags a missing AGENT_RUNNER_AUTO_BUILD gate', () => {
		expectFlagged(
			base.replace(/AGENT_RUNNER_AUTO_BUILD:/, '# AUTO_BUILD removed:'),
			'env-auto-build',
		);
	});

	it('flags a non-calm observation-triage default', () => {
		expectFlagged(
			base.replace(
				/AGENT_RUNNER_OBSERVATION_TRIAGE:\s*'off'/,
				"AGENT_RUNNER_OBSERVATION_TRIAGE: 'auto'",
			),
			'env-observation-triage-calm',
		);
	});

	it('flags an autoAdvance gate sneaking in', () => {
		expectFlagged(
			base.replace(
				/AGENT_RUNNER_AUTO_BUILD:/,
				"AGENT_RUNNER_AUTO_ADVANCE: 'true'\n  AGENT_RUNNER_AUTO_BUILD:",
			),
			'no-auto-advance-gate',
		);
	});

	it('flags an --isolated flag (CI runs in-place)', () => {
		expectFlagged(
			base.replace(
				/--merge --arbiter origin/,
				'--merge --isolated --arbiter origin',
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
				/run: agent-runner advance -n 10 --merge --arbiter origin/,
				'run: cp x .github/workflows/evil.yml',
			),
			'never-edits-dot-github-workflows',
		);
	});
});

// ─── emitted via the registry + --fake seam (no network, no real GitHub) ─────

describe('the capability self-registers and emits through installCI --fake', () => {
	it('loadCapabilityRegistry picks up the build-slice-tick module (no shared-list edit)', async () => {
		// The capability self-registers from its own file under
		// `install-ci-capabilities/`, discovered WITHOUT any shared-list edit.
		const caps = await loadCapabilityRegistry();
		expect(caps.map((c) => c.id)).toContain(BUILD_SLICE_TICK_CAPABILITY_ID);
	});

	it('installCI --fake writes the workflow under .fake/, never the real .github/, and sets NO real secret', async () => {
		const caps = await loadCapabilityRegistry();
		const buildTick = caps.find(
			(c) => c.id === BUILD_SLICE_TICK_CAPABILITY_ID,
		)!;
		expect(buildTick).toBeDefined();

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
			capabilities: [buildTick],
			log: () => {},
		});

		// The workflow was written under .fake/, NEVER the real .github/.
		const fakePath = join(work, '.fake', BUILD_SLICE_TICK_WORKFLOW_PATH);
		expect(existsSync(fakePath)).toBe(true);
		expect(existsSync(join(work, '.github'))).toBe(false);
		expect(result.written).toContain(
			join('.fake', BUILD_SLICE_TICK_WORKFLOW_PATH),
		);

		// The produced YAML structurally validates.
		const text = readFileSync(fakePath, 'utf8');
		expect(validateBuildSliceTickWorkflow(text).ok).toBe(true);

		// Shared-write isolation: NO real secret set, real .github/ + ~ untouched.
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
