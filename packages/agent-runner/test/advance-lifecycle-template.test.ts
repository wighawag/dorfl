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
	loadAdvanceCiTemplate,
	validateAdvanceCiTemplate,
} from '../src/advance-ci-template.js';
import {
	ADVANCE_LIFECYCLE_CAPABILITY_ID,
	ADVANCE_LIFECYCLE_WORKFLOW_PATH,
	generateAdvanceLifecycleWorkflow,
	validateAdvanceLifecycleWorkflow,
} from '../src/advance-lifecycle-template.js';

/**
 * `install-ci-advance-lifecycle-workflow` — capability C: auto-triage observations
 * + surface declared blockers + apply committed answers (the "human is the clock"
 * loop). CI ALWAYS invokes `advance` (a strict superset of `do`; with the lifecycle
 * gates calm it degrades to `do`'s build/slice behaviour — ADR
 * ci-config-policy-and-gate-family §1); the verb is never a user decision. The
 * workflow is the absorbed-and-parameterised seed `docs/ci/advance-loop.yml.template`
 * (NOT a competing hand-rolled advance workflow).
 *
 * SEAMS: the workflow is generated into the `--fake` scratch dir with a STUBBED
 * `GitHubCIContext` ({@link MemoryCIProviderContext}: `setSecret` records to
 * memory, `ghAvailable=false`, `repo` a fixture) — NO network, NO real `gh`, NO
 * real GitHub. The produced YAML is structurally validated (and ALSO cross-checked
 * against the seed's own validator `src/advance-ci-template.ts`); the on-answer
 * trigger, both calm-default lifecycle env vars, the matrix/sequential split, the
 * preserved capability-F reap job, the concurrency group, and the US #9 self-edit
 * prohibition are asserted; and shared-write isolation (real `.github/` + real
 * secrets untouched) is pinned.
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
	work = mkdtempSync(join(tmpdir(), 'advance-lifecycle-'));
});
afterEach(() => {
	rmSync(work, {recursive: true, force: true});
});

// ─── the generated workflow satisfies every structural invariant ─────────────

describe('the advance-lifecycle workflow satisfies every structural invariant', () => {
	it('the shipped emitter output passes validation cleanly', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		const result = validateAdvanceLifecycleWorkflow(text);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('is deterministic — the same config produces byte-identical output', () => {
		expect(generateAdvanceLifecycleWorkflow(config)).toBe(
			generateAdvanceLifecycleWorkflow(config),
		);
	});

	it('is the PARAMETERISED seed: it ALSO passes the seed validator (advance-ci-template)', () => {
		// The emitted workflow is the seed `advance-loop.yml.template`, parameterised
		// — so it must satisfy the seed's OWN structural validator too (not just this
		// slice's). This pins "we absorbed the seed", not "we hand-rolled a competing
		// advance workflow". Sanity: the seed template itself still validates.
		expect(validateAdvanceCiTemplate(loadAdvanceCiTemplate()).ok).toBe(true);

		const text = generateAdvanceLifecycleWorkflow(config);
		const result = validateAdvanceCiTemplate(text);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('CI ALWAYS invokes `advance`, NEVER `do` (the verb is not a user decision)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/agent-runner advance\b/.test(text)).toBe(true);
		expect(/agent-runner do\b/.test(text)).toBe(false);
	});

	it('triggers on cron + workflow_dispatch + the on-answer-committed push (work/questions/**)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/\bschedule:\s*[\s\S]*?-\s*cron:/.test(text)).toBe(true);
		expect(/\bworkflow_dispatch:/.test(text)).toBe(true);
		expect(
			/workflow_dispatch:[\s\S]*?inputs:[\s\S]*?integrationMode:/.test(text),
		).toBe(true);
		// The DEFINING lifecycle trigger: the on-answer-committed push.
		expect(/\bpush:\s*[\s\S]*?paths:[\s\S]*?work\/questions\//.test(text)).toBe(
			true,
		);
	});

	it('propose ⇒ a DYNAMIC matrix enumerated via `scan --json`, one `advance --propose` per item', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
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
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/agent-runner advance -n\b/.test(text)).toBe(true);
		expect(/agent-runner advance -n\b[^\n]*--merge\b/.test(text)).toBe(true);
		expect(/advance-merge:[\s\S]*?strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(
			false,
		);
	});

	it('ONE word `integrationMode` drives BOTH the flag and the derived job shape (matches the build tick)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
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

	it('exposes the two ORTHOGONAL lifecycle gates at calm defaults (no questions out of the box)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/AGENT_RUNNER_AUTO_BUILD:/.test(text)).toBe(true);
		expect(/AGENT_RUNNER_AUTO_SLICE:/.test(text)).toBe(true);
		// The two lifecycle gates sit at their calm defaults → degrades to
		// build/slice-only with no questions until opted in.
		expect(/AGENT_RUNNER_OBSERVATION_TRIAGE:\s*'off'/.test(text)).toBe(true);
		expect(/AGENT_RUNNER_SURFACE_BLOCKERS:\s*'false'/.test(text)).toBe(true);
		// No `autoAdvance` gate (the lifecycle decomposes into the gate family).
		expect(/AGENT_RUNNER_AUTO_ADVANCE\b/.test(text)).toBe(false);
		expect(
			validateAdvanceLifecycleWorkflow(text).problems.map((p) => p.id),
		).not.toContain('no-auto-advance-gate');
	});

	it('the two lifecycle gates are orthogonal — "groom observations, leave blocked work" is expressible', () => {
		// Flip OBSERVATION_TRIAGE on while leaving SURFACE_BLOCKERS off: the env
		// block is a flat list of independent vars, so this is a one-line edit and
		// the workflow still validates (the gates are peers, not a hierarchy).
		const expressed = generateAdvanceLifecycleWorkflow(config).replace(
			/AGENT_RUNNER_OBSERVATION_TRIAGE:\s*'off'/,
			"AGENT_RUNNER_OBSERVATION_TRIAGE: 'ask'",
		);
		expect(/AGENT_RUNNER_OBSERVATION_TRIAGE:\s*'ask'/.test(expressed)).toBe(
			true,
		);
		expect(/AGENT_RUNNER_SURFACE_BLOCKERS:\s*'false'/.test(expressed)).toBe(
			true,
		);
	});

	it('PRESERVES capability F: the reap-merged-branches job + sweepMergedBranches input (not stripped)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/reap-merged-branches:/.test(text)).toBe(true);
		expect(/agent-runner gc --remote-branches\b/.test(text)).toBe(true);
		expect(/sweepMergedBranches:/.test(text)).toBe(true);
		// No SEPARATE gc-sweep workflow is emitted — F rides this tick's schedule.
		expect(ADVANCE_LIFECYCLE_WORKFLOW_PATH).toBe(
			'workflows/advance-lifecycle.yml',
		);
	});

	it('runs IN-PLACE (no --isolated/--remote on any invocation) and carries a concurrency group', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		const result = validateAdvanceLifecycleWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain('no-isolated-flag');
		expect(result.problems.map((p) => p.id)).not.toContain('no-remote-flag');
		expect(/\bconcurrency:\s*[\s\S]*?group:/.test(text)).toBe(true);
	});

	it('wires the SHARED composite setup action into every job', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(
			/uses:\s*\.\/\.github\/actions\/agent-runner-setup\b/.test(text),
		).toBe(true);
	});

	it('the fully-autonomous-to-main path is a loud, NON-DEFAULT opt-in (default is propose)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/default:\s*'propose'/.test(text)).toBe(true);
		expect(
			text.includes("github.event.inputs.integrationMode || 'propose'"),
		).toBe(true);
	});

	it('uses explicit slug prefixes (slice:/prd:), never bare', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(text).toContain('"slice:" + .slug');
	});

	it('US #9: requests NO `workflows` permission and no job step touches the workflows tree', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/\bworkflows:\s*write\b/.test(text)).toBe(false);
		const result = validateAdvanceLifecycleWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'never-edits-dot-github-workflows',
		);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'no-workflows-permission',
		);
	});
});

// ─── the validator FLAGS a workflow missing each invariant ───────────────────

describe('validateAdvanceLifecycleWorkflow flags a workflow missing each invariant', () => {
	const base = generateAdvanceLifecycleWorkflow(config);

	const expectFlagged = (broken: string, id: string): void => {
		const result = validateAdvanceLifecycleWorkflow(broken);
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

	it('flags a MISSING on-answer-committed push trigger (the lifecycle answer loop)', () => {
		// Strip the `push:` trigger block (between `schedule:` and `workflow_dispatch:`)
		// AND the reap job's `if:` reference is fine; just remove the trigger paths.
		const broken = base.replace(
			/  push:\n    # On-answer-committed[\s\S]*?- 'work\/questions\/\*\*'\n/,
			'',
		);
		expectFlagged(broken, 'trigger-on-answer-committed');
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

	it('flags a non-calm surface-blockers default', () => {
		expectFlagged(
			base.replace(
				/AGENT_RUNNER_SURFACE_BLOCKERS:\s*'false'/,
				"AGENT_RUNNER_SURFACE_BLOCKERS: 'true'",
			),
			'env-surface-blockers-calm',
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

	it('flags a stripped capability-F reap job', () => {
		expectFlagged(
			base.replace(/reap-merged-branches:/, '# reap removed:'),
			'reap-merged-branches-job',
		);
	});

	it('flags a stripped gc --remote-branches invocation', () => {
		expectFlagged(
			base.replace(
				/agent-runner gc --remote-branches --arbiter origin/,
				'echo skip',
			),
			'reap-uses-gc-remote-branches',
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

	it('flags a dropped shared composite setup action', () => {
		expectFlagged(
			base.replace(
				/uses: \.\/\.github\/actions\/agent-runner-setup/g,
				'run: echo no-setup',
			),
			'uses-shared-setup-action',
		);
	});
});

// ─── emitted via the registry + --fake seam (no network, no real GitHub) ─────

describe('the capability self-registers and emits through installCI --fake', () => {
	it('loadCapabilityRegistry picks up the advance-lifecycle module (no shared-list edit)', async () => {
		// The capability self-registers from its own file under
		// `install-ci-capabilities/`, discovered WITHOUT any shared-list edit.
		const caps = await loadCapabilityRegistry();
		expect(caps.map((c) => c.id)).toContain(ADVANCE_LIFECYCLE_CAPABILITY_ID);
	});

	it('installCI --fake writes the workflow under .fake/, never the real .github/, and sets NO real secret', async () => {
		const caps = await loadCapabilityRegistry();
		const advanceLifecycle = caps.find(
			(c) => c.id === ADVANCE_LIFECYCLE_CAPABILITY_ID,
		)!;
		expect(advanceLifecycle).toBeDefined();

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
			capabilities: [advanceLifecycle],
			log: () => {},
		});

		// The workflow was written under .fake/, NEVER the real .github/.
		const fakePath = join(work, '.fake', ADVANCE_LIFECYCLE_WORKFLOW_PATH);
		expect(existsSync(fakePath)).toBe(true);
		expect(existsSync(join(work, '.github'))).toBe(false);
		expect(result.written).toContain(
			join('.fake', ADVANCE_LIFECYCLE_WORKFLOW_PATH),
		);

		// The produced YAML structurally validates (this slice's + the seed's).
		const text = readFileSync(fakePath, 'utf8');
		expect(validateAdvanceLifecycleWorkflow(text).ok).toBe(true);
		expect(validateAdvanceCiTemplate(text).ok).toBe(true);

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
