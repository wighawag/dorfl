import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
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
	DEFAULT_MAX_PARALLEL,
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
 * gates calm it degrades to `do`'s build/task behaviour — ADR
 * ci-config-policy-and-gate-family §1); the verb is never a user decision. The
 * workflow is the absorbed-and-parameterised seed `docs/ci/advance-loop.yml.template`
 * (NOT a competing hand-rolled advance workflow).
 *
 * SEAMS: the workflow is generated into the `--fake` scratch dir with a STUBBED
 * `GitHubCIContext` ({@link MemoryCIProviderContext}: `setSecret` records to
 * memory, `ghAvailable=false`, `repo` a fixture) — NO network, NO real `gh`, NO
 * real GitHub. The produced YAML is structurally validated (and ALSO cross-checked
 * against the seed's own validator `src/advance-ci-template.ts`); the on-answer
 * trigger, both calm-default lifecycle env vars, the per-item dispatch, the
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
	installSource: 'registry',
	maxParallel: 4,
};

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'advance-lifecycle-'));
});
afterEach(() => {
	rmrf(work);
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

	it('the tick runs NO agent: no provider secret anywhere, and enumerate/reap use the writer-role setup', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		// The agent runs in the per-item workflow's agent job, never here.
		expect(text).not.toMatch(/secrets\.ANTHROPIC_API_KEY/);
		expect(text).toMatch(
			/dorfl-setup-writer\n      - name: apply dispatch gate overrides[\s\S]*?\n      - id: scan/,
		);
		expect(text).toMatch(
			/dorfl-setup-writer\n      - name: reap merged remote/,
		);
		expect(text).not.toMatch(/uses: \.\/\.github\/actions\/dorfl-setup\n/);
	});

	it('the dispatch job forwards integrationMode (default propose) to every item run', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(text).toContain(
			"INTEGRATION_MODE: ${{ github.event.inputs.integrationMode || 'propose' }}",
		);
		expect(text).toContain('-f "integrationMode=${INTEGRATION_MODE}"');
		expect(/dorfl advance -n\b/.test(text)).toBe(false);
	});

	it('is the PARAMETERISED seed: it ALSO passes the seed validator (advance-ci-template)', () => {
		// The emitted workflow is the seed `advance-loop.yml.template`, parameterised
		// — so it must satisfy the seed's OWN structural validator too (not just this
		// task's). This pins "we absorbed the seed", not "we hand-rolled a competing
		// advance workflow". Sanity: the seed template itself still validates.
		expect(validateAdvanceCiTemplate(loadAdvanceCiTemplate()).ok).toBe(true);

		const text = generateAdvanceLifecycleWorkflow(config);
		const result = validateAdvanceCiTemplate(text);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('the tick runs no agent verb itself (`advance` runs in the per-item workflow), NEVER `do`', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/dorfl (?:advance|do|intake)\b/.test(text)).toBe(false);
		expect(text).toContain('gh workflow run dorfl-item-dispatch.yml');
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

	it('one dorfl-item-dispatch.yml run per item enumerated via `scan --json`, never a matrix (one item per run, decision 1)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(false);
		expect(text).toContain('dorfl scan --json');
		expect(text).toContain('ITEMS: ${{ needs.enumerate.outputs.items }}');
		expect(text).toMatch(
			/gh workflow run dorfl-item-dispatch\.yml -R "\$\{REPO\}" --ref "\$\{DEFAULT_BRANCH\}" "\$\{args\[@\]\}"/,
		);
		// The advance-propose / advance-merge matrix jobs are gone.
		expect(text).not.toMatch(/advance-(?:propose|merge):/);
	});

	it('spreads the item runs over `maxParallel` slots from config (slot = index mod maxParallel)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(text).toContain("MAX_PARALLEL: '4'");
		expect(text).toContain('slot=$(( i % MAX_PARALLEL ))');
		expect(text).toContain('-f "slot=${slot}"');
		expect(text).not.toMatch(/max-parallel:/);
		const overridden = generateAdvanceLifecycleWorkflow({
			...config,
			maxParallel: 8,
		});
		expect(overridden).toContain("MAX_PARALLEL: '8'");
		// Sanity: the default matches DEFAULT_MAX_PARALLEL.
		expect(DEFAULT_MAX_PARALLEL).toBe(2);
	});

	it('computes no agent timeout: the item lock job owns it (agentTimeoutMinutes from dorfl.json at the base)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/timeout-minutes:/.test(text)).toBe(false);
		expect(text).not.toContain('githubTimeout');
		expect(text).not.toContain('dorfl config --json');
	});

	it(
		'the propose `enumerate` `jq` UNIONS taskable SPECS into the matrix as ' +
			'`spec:<slug>` legs alongside the task legs (task ' +
			'`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`)',
		() => {
			const text = generateAdvanceLifecycleWorkflow(config);
			// Without this, `DORFL_AUTO_TASK: 'true'` above is dead on the hourly
			// cron — a ready ungated SPEC never becomes a matrix leg. The `jq` must read
			// `scan --json`'s taskable-SPEC pool (`repos[].specs[]` + `cwd.repo.specs[]`)
			// AND the task pool, and emit BOTH `task:<slug>` and `spec:<slug>` ids.
			// HARD CUTOVER: the pool emits `spec:` legs (the dead `prd:` leg is GONE).
			expect(/"task:" \+ \.slug/.test(text)).toBe(true);
			expect(/"spec:" \+ \.slug/.test(text)).toBe(true);
			expect(/\.repos\[\]\.specs\[\]\?/.test(text)).toBe(true);
			expect(/\.cwd\.repo\.specs\[\]\?/.test(text)).toBe(true);
		},
	);

	it('the tick grants nothing at workflow level; enumerate reads, dispatch holds actions: write only, reap writes contents', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(text).toMatch(/^permissions: \{\}$/m);
		expect(text).toMatch(
			/\n  enumerate:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    outputs:/,
		);
		expect(text).toMatch(
			/\n  dispatch:\n[\s\S]*?\n    permissions:\n      actions: write\n    steps:/,
		);
		expect(text).toMatch(
			/\n  reap-merged-branches:\n[\s\S]*?\n    permissions:\n      contents: write\n    steps:/,
		);
	});

	it('the on-answer-committed push trigger is pinned to the default branch (main)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(text).toMatch(
			/\n  push:\n(?:    #[^\n]*\n)*    branches:\n      - main\n    paths:\n      - 'work\/questions\/\*\*'\n/,
		);
		expect(
			validateAdvanceLifecycleWorkflow(
				text.replace(/    branches:\n      - main\n    paths:/, '    paths:'),
			).problems.map((p) => p.id),
		).toContain('push-pinned-to-main');
	});

	it('ONE word `integrationMode` is the dispatch input the tick forwards (no second knob)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(text).toContain('integrationMode:');
		expect(/github\.event\.inputs\.integrationMode/.test(text)).toBe(true);
		expect(text).toContain("if: ${{ needs.enumerate.outputs.any == 'true' }}");
	});

	it('emits NO active DORFL_* gate env (env carries no defaults; per-repo config wins)', () => {
		// The task `install-ci-emits-no-gate-env-let-config-decide`: the workflow
		// must NOT carry any of the four gate-family env assignments as an ACTIVE
		// line. The previous baked-in env block forced the env layer to shadow the
		// repo's own `dorfl.json`. Now CI resolves gates from config like
		// any other consumer (flag > env > per-repo > global > default).
		const text = generateAdvanceLifecycleWorkflow(config);
		// `operative` = the non-comment lines (the explanatory header comment may
		// still NAME the keys to document the posture; comments are not assignments).
		const operative = text
			.split('\n')
			.filter((line) => !/^\s*#/.test(line))
			.join('\n');
		expect(/DORFL_AUTO_BUILD\s*:/.test(operative)).toBe(false);
		expect(/DORFL_AUTO_TASK\s*:/.test(operative)).toBe(false);
		expect(/DORFL_OBSERVATION_TRIAGE\s*:/.test(operative)).toBe(false);
		expect(/DORFL_SURFACE_BLOCKERS\s*:/.test(operative)).toBe(false);
		// No `autoAdvance` gate either (the lifecycle decomposes into the family).
		expect(/DORFL_AUTO_ADVANCE\b/.test(operative)).toBe(false);
		expect(
			validateAdvanceLifecycleWorkflow(text).problems.map((p) => p.id),
		).not.toContain('no-auto-advance-gate');
	});

	it('exposes the four gate-family knobs as one-shot workflow_dispatch overrides, exported in enumerate (before scan) and forwarded to every item run', () => {
		// Task `advance-lifecycle-dispatch-gate-inputs`: a human can flip a gate ON
		// for ONE manual run. The review fix: the override MUST reach the `enumerate`
		// job (which gates the item pools via `scan`), not just the item runs —
		// otherwise an `observationTriage`/`surfaceBlockers`/`autoTask` override
		// yields an empty matrix and is silently inert.
		const text = generateAdvanceLifecycleWorkflow(config);

		// (a) Each gate is a workflow_dispatch input.
		for (const input of [
			'autoBuild',
			'autoTask',
			'observationTriage',
			'surfaceBlockers',
		]) {
			expect(
				new RegExp(
					`workflow_dispatch:[\\s\\S]*?inputs:[\\s\\S]*?\\b${input}:`,
				).test(text),
			).toBe(true);
		}
		// The blank sentinel option (don't-override) is present for autoBuild.
		expect(text).toMatch(/autoBuild:[\s\S]*?default: ''[\s\S]*?type: choice/);

		// (b) Each gate's override is a blank-guarded $GITHUB_ENV write (so blank /
		// schedule / push emit nothing — an empty value would make env coercion throw).
		for (const [input, envVar] of [
			['autoBuild', 'DORFL_AUTO_BUILD'],
			['autoTask', 'DORFL_AUTO_TASK'],
			['observationTriage', 'DORFL_OBSERVATION_TRIAGE'],
			['surfaceBlockers', 'DORFL_SURFACE_BLOCKERS'],
		] as const) {
			// The input reaches the shell through the step env (DISPATCH_<X>), never
			// as `${{ }}` text inside `run:` (script injection).
			const dispatchVar = envVar.replace(/^DORFL_/, 'DISPATCH_');
			expect(
				new RegExp(
					`${dispatchVar}: \\$\\{\\{ github\\.event\\.inputs\\.${input} \\}\\}[\\s\\S]*?` +
						`\\[ -n "\\$\\{${dispatchVar}\\}" \\] && echo "${envVar}=\\$\\{${dispatchVar}\\}"`,
				).test(text),
			).toBe(true);
		}

		// (c) THE review fix: the enumerate job applies the override BEFORE `scan`.
		expect(text).toMatch(
			/enumerate:[\s\S]*?DORFL_OBSERVATION_TRIAGE=[\s\S]*?id: scan/,
		);
		// And the dispatch job forwards each non-blank override to every item run
		// (whose lock, agent and apply jobs export it).
		for (const input of [
			'autoBuild',
			'autoTask',
			'observationTriage',
			'surfaceBlockers',
		]) {
			expect(text).toMatch(
				new RegExp(`args\\+=\\(-f "${input}=\\$\\{DISPATCH_`),
			);
		}

		// (d) The whole override is guarded by the workflow_dispatch event, so a
		// schedule/push tick never enters the write step (the override is dispatch-only).
		expect(text).toMatch(
			/if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/,
		);

		// (e) These writes are `=` shell assignments, NOT `:` YAML env keys, so the
		// `no-gate-env-*` invariants (env carries no defaults) still hold.
		const operative = text
			.split('\n')
			.filter((line) => !/^\s*#/.test(line))
			.join('\n');
		expect(/DORFL_AUTO_BUILD\s*:/.test(operative)).toBe(false);
		expect(validateAdvanceLifecycleWorkflow(text).ok).toBe(true);
	});

	it('a user CAN add an opt-in CI-only gate env override without breaking the validator', () => {
		// The env layer is the OPTIONAL CI-only override layer: a user who wants a
		// CI-specific gate value adds the env var themselves. That edit is fine
		// (the validator only forbids the EMITTED workflow shipping with active
		// gate env; a user's hand-edit is out of scope of the shipped emitter).
		const base = generateAdvanceLifecycleWorkflow(config);
		// Sanity: the SHIPPED emitter has none of the four as active env.
		const baseOperative = base
			.split('\n')
			.filter((line) => !/^\s*#/.test(line))
			.join('\n');
		expect(/DORFL_AUTO_BUILD\s*:/.test(baseOperative)).toBe(false);
		expect(/DORFL_SURFACE_BLOCKERS\s*:/.test(baseOperative)).toBe(false);
	});

	it('PRESERVES capability F: the reap-merged-branches job + sweepMergedBranches input (not stripped)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/reap-merged-branches:/.test(text)).toBe(true);
		expect(/dorfl gc --remote-branches\b/.test(text)).toBe(true);
		expect(/sweepMergedBranches:/.test(text)).toBe(true);
		// No SEPARATE gc-sweep workflow is emitted — F rides this tick's schedule.
		expect(ADVANCE_LIFECYCLE_WORKFLOW_PATH).toBe(
			'workflows/advance-lifecycle.yml',
		);
	});

	it('carries the no-agent `surface-merge-questions` writer job (task wire-merge-questions-into-the-advance-tick), in the seed too', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		const job =
			/\n {2}surface-merge-questions:[\s\S]*?(?=\n {2}#|\n {2}\S+:\n|$)/.exec(
				text,
			)?.[0];
		expect(job).toBeDefined();
		expect(job).toContain('contents: write');
		expect(job).toContain(
			'run: dorfl surface-merge-questions --arbiter origin',
		);
		expect(job).toContain('uses: ./.github/actions/dorfl-setup-writer');
		// No agent: no provider key, no agent-role setup, no agent verb.
		expect(job).not.toMatch(
			/ANTHROPIC|OPENAI|dorfl-setup\n|dorfl (?:advance|do)\b/,
		);
		// `enumerate` stays read-only and runs no surfacer.
		expect(
			/\n {2}enumerate:[\s\S]*?\n {2}dispatch:/.exec(text)?.[0],
		).not.toContain('surface-merge-questions');
		// The seed carries the same job (install-ci parameterises it).
		expect(loadAdvanceCiTemplate()).toContain(
			'run: dorfl surface-merge-questions --arbiter origin',
		);
	});

	it('the SCHEDULED `gc --remote-branches` invocation ALSO reaps orphan sidecars (US #10) — it fires in CI, not behind an un-passed flag', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		const result = validateAdvanceLifecycleWorkflow(text);
		// The orphan-sidecar sweep rides the EXACT invocation the scheduled tick runs.
		expect(/dorfl gc --remote-branches --arbiter origin/.test(text)).toBe(true);
		// The reap job checks out a working tree (the orphan sweep is working-tree
		// based) and the step names the orphan-sidecar duty so the linkage is visible.
		expect(result.problems.map((p) => p.id)).not.toContain(
			'reap-checks-out-working-tree',
		);
		expect(result.problems.map((p) => p.id)).not.toContain(
			'reap-names-orphan-sidecars',
		);
		expect(/reap-merged-branches:[\s\S]*?orphan sidecar/i.test(text)).toBe(
			true,
		);
	});

	it('runs IN-PLACE (no --isolated/--remote on any invocation) and carries a concurrency group', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		const result = validateAdvanceLifecycleWorkflow(text);
		expect(result.problems.map((p) => p.id)).not.toContain('no-isolated-flag');
		expect(result.problems.map((p) => p.id)).not.toContain('no-remote-flag');
		expect(/\bconcurrency:\s*[\s\S]*?group:/.test(text)).toBe(true);
	});

	it('wires the writer-role setup action into the jobs that set up dorfl', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(
			/uses:\s*\.\/\.github\/actions\/dorfl-setup-writer\b/.test(text),
		).toBe(true);
	});

	it('the fully-autonomous-to-main path is a loud, NON-DEFAULT opt-in (default is propose)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/default:\s*'propose'/.test(text)).toBe(true);
		expect(
			text.includes("github.event.inputs.integrationMode || 'propose'"),
		).toBe(true);
	});

	it('uses explicit slug prefixes (task:/spec:), never bare', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(text).toContain('"task:" + .slug');
		expect(text).toContain('"spec:" + .slug');
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
				/run: dorfl gc --remote-branches --arbiter origin/,
				'run: dorfl do task:x --merge',
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

	it('flags an item value spliced into the dispatch `run:` as `${{ }}` (script injection)', () => {
		expectFlagged(
			base.replace(
				/gh workflow run dorfl-item-dispatch\.yml -R "\$\{REPO\}"/,
				'gh workflow run dorfl-item-dispatch.yml -R "${REPO}" -f item=${{ matrix.item }}',
			),
			'item-values-not-spliced-into-run',
		);
	});

	it('flags a dispatch that stops forwarding integrationMode', () => {
		expectFlagged(
			base.replace(' -f "integrationMode=${INTEGRATION_MODE}"', ''),
			'dispatch-forwards-integration-mode',
		);
	});

	it('flags a dispatch that stops skipping the active item runs', () => {
		expectFlagged(
			base.replace(/gh run list[^\n]*/, 'active=""'),
			'dispatch-skips-active-runs',
		);
	});

	it('flags a matrix sneaking back (one item per run)', () => {
		expectFlagged(
			base.replace(
				/(\n  dispatch:\n)/,
				'\n  legs:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        item: [a]\n    steps:\n      - run: echo\n$1',
			),
			'no-matrix',
		);
	});

	it('flags a checkout or a setup step in the dispatch job (actions: write next to repository code)', () => {
		expectFlagged(
			base.replace(
				/(\n  dispatch:\n[\s\S]*?\n    steps:\n)/,
				'$1      - uses: actions/checkout@v7\n',
			),
			'dispatch-no-checkout-no-setup',
		);
	});

	it('flags a dispatch job holding more than actions: write', () => {
		expectFlagged(
			base.replace(
				/(\n  dispatch:\n[\s\S]*?\n    permissions:\n      actions: write\n)/,
				'$1      contents: write\n',
			),
			'dispatch-actions-write-only',
		);
	});

	it('flags a re-introduced active DORFL_AUTO_BUILD env assignment', () => {
		// Inject an active env line under the dispatch job's `env:` block (right
		// after the MAX_PARALLEL line). Any active form of the four gate keys
		// must FAIL the validator: env is the opt-in CI-only OVERRIDE layer, not
		// the carrier of defaults.
		expectFlagged(
			base.replace(
				/(MAX_PARALLEL:[^\n]*\n)/,
				"$1          DORFL_AUTO_BUILD: 'true'\n",
			),
			'no-gate-env-auto-build',
		);
	});

	it('flags a re-introduced active DORFL_AUTO_TASK env assignment', () => {
		expectFlagged(
			base.replace(
				/(MAX_PARALLEL:[^\n]*\n)/,
				"$1          DORFL_AUTO_TASK: 'true'\n",
			),
			'no-gate-env-auto-task',
		);
	});

	it('flags a re-introduced active DORFL_OBSERVATION_TRIAGE env assignment', () => {
		expectFlagged(
			base.replace(
				/(MAX_PARALLEL:[^\n]*\n)/,
				"$1          DORFL_OBSERVATION_TRIAGE: 'ask'\n",
			),
			'no-gate-env-observation-triage',
		);
	});

	it('flags a re-introduced active DORFL_SURFACE_BLOCKERS env assignment', () => {
		expectFlagged(
			base.replace(
				/(MAX_PARALLEL:[^\n]*\n)/,
				"$1          DORFL_SURFACE_BLOCKERS: 'true'\n",
			),
			'no-gate-env-surface-blockers',
		);
	});

	it('flags an autoAdvance gate sneaking in', () => {
		expectFlagged(
			base.replace(
				/(MAX_PARALLEL:[^\n]*\n)/,
				"$1          DORFL_AUTO_ADVANCE: 'true'\n",
			),
			'no-auto-advance-gate',
		);
	});

	it(
		'flags a regression to a TASK-ONLY `jq` (no `spec:` legs) — the propose ' +
			'matrix must enumerate the taskable-SPEC pool',
		() => {
			// Pre-fix shape: task-only `jq` over `items[]` only. Reintroducing it must
			// be flagged so `DORFL_AUTO_TASK` is never silently dead on the cron.
			const broken = base
				.replace(/"spec:" \+ \.slug/g, '"task:" + .slug')
				.replace(/\.repos\[\]\.specs\[\]\?/g, '.repos[].items[]?')
				.replace(/\.cwd\.repo\.specs\[\]\?/g, '.cwd.repo.items[]?');
			expectFlagged(broken, 'propose-enumerates-taskable-specs');
		},
	);

	it(
		'flags a regression that DROPS the lifecycle union (no `obs:` / no ' +
			'`lifecycle.*` reads) — the propose matrix must enumerate triage/surface/apply',
		() => {
			// Pre-fix shape: a build/task-only `jq` with the whole lifecycle union
			// removed. Reintroducing it must be flagged so the answer-loop is never
			// silently merge-only again.
			const broken = base.replace(
				/ \+ \[\(\.repos\[\]\.lifecycle\.triage\[\]\?[\s\S]*?\.namespace \+ ":" \+ \.slug\]/,
				'',
			);
			expectFlagged(broken, 'propose-enumerates-lifecycle-items');
		},
	);

	it('flags a stripped capability-F reap job', () => {
		expectFlagged(
			base.replace(/reap-merged-branches:/, '# reap removed:'),
			'reap-merged-branches-job',
		);
	});

	it('flags a stripped surface-merge-questions job', () => {
		expectFlagged(
			base.replace(/surface-merge-questions:/, '# removed:'),
			'surface-merge-questions-job',
		);
		expectFlagged(
			base.replace(
				/run: dorfl surface-merge-questions --arbiter origin/,
				'run: echo skip',
			),
			'surface-merge-questions-runs-the-command',
		);
	});

	it('flags a stripped gc --remote-branches invocation', () => {
		expectFlagged(
			base.replace(/dorfl gc --remote-branches --arbiter origin/, 'echo skip'),
			'reap-uses-gc-remote-branches',
		);
	});

	it('flags a reap job that drops the orphan-sidecar naming (US #10 linkage lost)', () => {
		expectFlagged(
			base.replace(/orphan sidecar/gi, 'merged branch'),
			'reap-names-orphan-sidecars',
		);
	});

	it('flags a reap job that drops its working-tree checkout (orphan sweep is working-tree based)', () => {
		// Remove the `uses: actions/checkout` line within the reap job only.
		const broken = base.replace(
			/(reap-merged-branches:[\s\S]*?)- uses: actions\/checkout@[^\n]*\n\s*with:\n\s*fetch-depth: 0\n/,
			'$1',
		);
		expectFlagged(broken, 'reap-checks-out-working-tree');
	});

	it('flags an --isolated flag (CI runs in-place)', () => {
		expectFlagged(
			base.replace(
				/dorfl gc --remote-branches --arbiter origin/,
				'dorfl gc --remote-branches --isolated --arbiter origin',
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
				/run: dorfl gc --remote-branches --arbiter origin/,
				'run: cp x .github/workflows/evil.yml',
			),
			'never-edits-dot-github-workflows',
		);
	});

	it('flags a dropped writer-role setup action', () => {
		expectFlagged(
			base.replace(
				/uses: \.\/\.github\/actions\/dorfl-setup-writer/g,
				'run: echo no-setup',
			),
			'uses-writer-setup-action',
		);
	});

	it('flags the agent-role setup in the tick (no agent runs here)', () => {
		expectFlagged(
			base.replace(
				/uses: \.\/\.github\/actions\/dorfl-setup-writer\n      - name: reap/,
				'uses: ./.github/actions/dorfl-setup\n      - name: reap',
			),
			'no-agent-setup-action',
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

		// The produced YAML structurally validates (this task's + the seed's).
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
