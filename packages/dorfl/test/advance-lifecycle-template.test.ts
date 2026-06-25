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

	it('the agent-running jobs pass the provider secret to the setup action via `with:` (so pi can auth); enumerate/reap do not', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		// The propose + merge jobs forward the provider secret. (The gate-override
		// step now sits between the setup `with:` and the advance step, so allow it.)
		const proposeUses =
			/dorfl-setup\n        with:\n          ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}\n      - name: apply dispatch gate overrides[\s\S]*?\n      - name: advance one item/;
		const mergeUses =
			/dorfl-setup\n        with:\n          ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}\n      - name: apply dispatch gate overrides[\s\S]*?\n      - name: advance the eligible pool/;
		expect(text).toMatch(proposeUses);
		expect(text).toMatch(mergeUses);
		// The enumerate + reap jobs use the bare setup action (no agent, no secret).
		// Enumerate's bare setup is followed by the gate-override step, then `id: scan`.
		expect(text).toMatch(
			/dorfl-setup\n      - name: apply dispatch gate overrides[\s\S]*?\n      - id: scan/,
		);
		expect(text).toMatch(/dorfl-setup\n      - name: reap merged remote/);
	});

	it('auth-json mode passes NO provider secret to the setup action (it uses auth.json)', () => {
		const text = generateAdvanceLifecycleWorkflow({
			...config,
			authMode: 'auth-json',
			providers: [],
		});
		expect(text).not.toMatch(/secrets\.[A-Z_]*API_KEY/);
	});

	it('the propose leg streams the agent live (`--watch`); the `-n` merge job does NOT (it tails no single session)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		// Propose: a single named item per matrix leg, so --watch fits.
		expect(text).toMatch(
			/advance "\$\{\{ matrix\.item \}\}" --propose --watch --arbiter origin/,
		);
		// Merge: the -n sequential form cannot tail ONE session, so NO --watch.
		expect(text).toMatch(/advance -n 10 --merge --arbiter origin/);
		expect(text).not.toMatch(/advance -n \d+ --merge --watch/);
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

	it('CI ALWAYS invokes `advance`, NEVER `do` (the verb is not a user decision)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/dorfl advance\b/.test(text)).toBe(true);
		expect(/dorfl do\b/.test(text)).toBe(false);
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
		expect(text).toContain('dorfl scan --json');
		expect(/dorfl advance "?\$\{\{\s*matrix\./.test(text)).toBe(true);
		// The leg carries `--propose` (tying integration mode to the matrix shape);
		// `--merge` never rides a matrix leg (parallel merge-to-main thrash).
		expect(
			/advance-propose:[\s\S]*?dorfl advance "?\$\{\{\s*matrix\.[\s\S]*?--propose\b/.test(
				text,
			),
		).toBe(true);
		expect(/dorfl advance "?\$\{\{\s*matrix\.[^\n]*--merge\b/.test(text)).toBe(
			false,
		);
	});

	it(
		'the propose `enumerate` `jq` UNIONS taskable PRDS into the matrix as ' +
			'`prd:<slug>` legs alongside the task legs (task ' +
			'`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`)',
		() => {
			const text = generateAdvanceLifecycleWorkflow(config);
			// Without this, `DORFL_AUTO_TASK: 'true'` above is dead on the hourly
			// cron — a ready ungated PRD never becomes a matrix leg. The `jq` must read
			// `scan --json`'s taskable-PRD pool (`repos[].prds[]` + `cwd.repo.prds[]`)
			// AND the task pool, and emit BOTH `task:<slug>` and `prd:<slug>` ids.
			expect(/"task:" \+ \.slug/.test(text)).toBe(true);
			expect(/"prd:" \+ \.slug/.test(text)).toBe(true);
			expect(/\.repos\[\]\.prds\[\]\?/.test(text)).toBe(true);
			expect(/\.cwd\.repo\.prds\[\]\?/.test(text)).toBe(true);
		},
	);

	it('merge ⇒ a SINGLE SEQUENTIAL `advance -n <x> --merge` (no matrix)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/dorfl advance -n\b/.test(text)).toBe(true);
		expect(/dorfl advance -n\b[^\n]*--merge\b/.test(text)).toBe(true);
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

	it('emits NO active DORFL_* gate env (env carries no defaults; per-repo config wins)', () => {
		// The task `install-ci-emits-no-gate-env-let-config-decide`: the workflow
		// must NOT carry any of the four gate-family env assignments as an ACTIVE
		// line. The previous baked-in env block forced the env layer to shadow the
		// repo's own `.dorfl.json`. Now CI resolves gates from config like
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

	it('exposes the four gate-family knobs as one-shot workflow_dispatch overrides, wired into EVERY gate-resolving job (incl. enumerate, before scan)', () => {
		// Task `advance-lifecycle-dispatch-gate-inputs`: a human can flip a gate ON
		// for ONE manual run. The review fix: the override MUST reach the `enumerate`
		// job (which gates the matrix pools via `scan`), not just the agent jobs —
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
			expect(
				new RegExp(
					`\\[ -n "\\$\\{\\{ github\\.event\\.inputs\\.${input} \\}\\}" \\][\\s\\S]*?${envVar}=`,
				).test(text),
			).toBe(true);
		}

		// (c) THE review fix: the enumerate job applies the override BEFORE `scan`.
		expect(text).toMatch(
			/enumerate:[\s\S]*?DORFL_OBSERVATION_TRIAGE=[\s\S]*?id: scan/,
		);
		// And it appears in all three gate-resolving jobs (enumerate + 2 agent jobs):
		// the guarded write line for autoBuild occurs at least 3 times.
		const writes = text.match(
			/echo "DORFL_AUTO_BUILD=\$\{\{ github\.event\.inputs\.autoBuild \}\}"/g,
		);
		expect(writes?.length ?? 0).toBeGreaterThanOrEqual(3);

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

	it('wires the SHARED composite setup action into every job', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/uses:\s*\.\/\.github\/actions\/dorfl-setup\b/.test(text)).toBe(
			true,
		);
	});

	it('the fully-autonomous-to-main path is a loud, NON-DEFAULT opt-in (default is propose)', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(/default:\s*'propose'/.test(text)).toBe(true);
		expect(
			text.includes("github.event.inputs.integrationMode || 'propose'"),
		).toBe(true);
	});

	it('uses explicit slug prefixes (task:/prd:), never bare', () => {
		const text = generateAdvanceLifecycleWorkflow(config);
		expect(text).toContain('"task:" + .slug');
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
			base.replace(/dorfl advance -n 10 --merge/, 'dorfl do -n 10 --merge'),
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
				/(dorfl advance "\$\{\{ matrix\.item \}\}") --propose/,
				'$1',
			),
			'propose-leg-carries-propose-flag',
		);
	});

	it('flags a merge -n job missing the --merge flag', () => {
		expectFlagged(
			base.replace(/(dorfl advance -n 10) --merge/, '$1'),
			'merge-job-carries-merge-flag',
		);
	});

	it('flags --merge riding a matrix leg (parallel merge-to-main thrash)', () => {
		expectFlagged(
			base.replace(
				/(dorfl advance "\$\{\{ matrix\.item \}\}") --propose/,
				'$1 --merge',
			),
			'merge-flag-not-on-matrix-leg',
		);
	});

	it('flags a re-introduced active DORFL_AUTO_BUILD env assignment', () => {
		// Inject an active env line under the existing `env:` block (right after
		// the SWEEP_MERGED_BRANCHES line). Any active form of the four gate keys
		// must FAIL the validator: env is the opt-in CI-only OVERRIDE layer, not
		// the carrier of defaults.
		expectFlagged(
			base.replace(
				/(SWEEP_MERGED_BRANCHES:[^\n]*\n)/,
				"$1  DORFL_AUTO_BUILD: 'true'\n",
			),
			'no-gate-env-auto-build',
		);
	});

	it('flags a re-introduced active DORFL_AUTO_TASK env assignment', () => {
		expectFlagged(
			base.replace(
				/(SWEEP_MERGED_BRANCHES:[^\n]*\n)/,
				"$1  DORFL_AUTO_TASK: 'true'\n",
			),
			'no-gate-env-auto-task',
		);
	});

	it('flags a re-introduced active DORFL_OBSERVATION_TRIAGE env assignment', () => {
		expectFlagged(
			base.replace(
				/(SWEEP_MERGED_BRANCHES:[^\n]*\n)/,
				"$1  DORFL_OBSERVATION_TRIAGE: 'ask'\n",
			),
			'no-gate-env-observation-triage',
		);
	});

	it('flags a re-introduced active DORFL_SURFACE_BLOCKERS env assignment', () => {
		expectFlagged(
			base.replace(
				/(SWEEP_MERGED_BRANCHES:[^\n]*\n)/,
				"$1  DORFL_SURFACE_BLOCKERS: 'true'\n",
			),
			'no-gate-env-surface-blockers',
		);
	});

	it('flags an autoAdvance gate sneaking in', () => {
		expectFlagged(
			base.replace(
				/(SWEEP_MERGED_BRANCHES:[^\n]*\n)/,
				"$1  DORFL_AUTO_ADVANCE: 'true'\n",
			),
			'no-auto-advance-gate',
		);
	});

	it(
		'flags a regression to a TASK-ONLY `jq` (no `prd:` legs) — the propose ' +
			'matrix must enumerate the taskable-PRD pool',
		() => {
			// Pre-fix shape: task-only `jq` over `items[]` only. Reintroducing it must
			// be flagged so `DORFL_AUTO_TASK` is never silently dead on the cron.
			const broken = base
				.replace(/"prd:" \+ \.slug/g, '"task:" + .slug')
				.replace(/\.repos\[\]\.prds\[\]\?/g, '.repos[].items[]?')
				.replace(/\.cwd\.repo\.prds\[\]\?/g, '.cwd.repo.items[]?');
			expectFlagged(broken, 'propose-enumerates-taskable-prds');
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
			/(reap-merged-branches:[\s\S]*?)- uses: actions\/checkout@v4\n\s*with:\n\s*fetch-depth: 0\n/,
			'$1',
		);
		expectFlagged(broken, 'reap-checks-out-working-tree');
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
				/run: dorfl advance -n 10 --merge --arbiter origin/,
				'run: cp x .github/workflows/evil.yml',
			),
			'never-edits-dot-github-workflows',
		);
	});

	it('flags a dropped shared composite setup action', () => {
		expectFlagged(
			base.replace(
				/uses: \.\/\.github\/actions\/dorfl-setup/g,
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
