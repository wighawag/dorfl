import {describe, it, expect} from 'vitest';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	resolveAdvanceCiTemplatePath,
	loadAdvanceCiTemplate,
	validateAdvanceCiTemplate,
} from '../src/advance-ci-template.js';

/**
 * `advance-install-ci` — the CI-integration deliverable (PRD `advance-loop`, US
 * #27/28): the `install-ci` notion as a DOCUMENTED workflow TEMPLATE (chosen over
 * a CLI subcommand — see the slice's `## Decisions`). Per the acceptance criteria,
 * a documented template is VALIDATED here: it locates as a `.template` (so it
 * never self-triggers in THIS repo), parses into the required structural shape,
 * and references the right DRIVER invocations (propose ⇒ matrix enumerated via the
 * mirror-side `scan --json`; merge ⇒ a single sequential `advance -n`).
 *
 * `validateAdvanceCiTemplate` is the dependency-free counterpart of a YAML parse
 * (the package has no YAML lib, mirroring `frontmatter.ts`): a set of presence/
 * shape assertions over the raw text. The negative cases below construct a tmp
 * template missing each invariant and assert the validator FLAGS it — no shared/
 * global location is touched (only a throwaway tmp dir).
 */
describe('advance-install-ci — the CI workflow template (the install-ci notion)', () => {
	it('ships as a `.template`, so it never self-triggers as a live workflow here', () => {
		const path = resolveAdvanceCiTemplatePath();
		// A live `.github/workflows/*.yml` here would loop the tool on its own work;
		// the `.template` suffix keeps it inert until a consumer copies it.
		expect(path.endsWith('.yml.template')).toBe(true);
		expect(path).not.toContain(`${join('.github', 'workflows')}`);
	});

	it('the shipped template satisfies every structural invariant', () => {
		const text = loadAdvanceCiTemplate();
		const result = validateAdvanceCiTemplate(text);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('triggers on cron AND on-answer-committed (a push touching work/questions/*)', () => {
		const text = loadAdvanceCiTemplate();
		expect(/\bschedule:\s*[\s\S]*?-\s*cron:/.test(text)).toBe(true);
		expect(/work\/questions\//.test(text)).toBe(true);
	});

	it('propose mode is a MATRIX enumerated via the mirror-side pool scan, one advance per item', () => {
		const text = loadAdvanceCiTemplate();
		// A matrix strategy enumerated by `scan --json` (the mirror-side pool scan),
		// one `advance <matrix item>` per leg = one PR per item.
		expect(/strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(true);
		expect(text).toContain('agent-runner scan --json');
		expect(/agent-runner advance "?\$\{\{\s*matrix\./.test(text)).toBe(true);
	});

	it('each propose matrix leg carries --propose, tying integration mode to the matrix shape', () => {
		const text = loadAdvanceCiTemplate();
		// The fix for the Gate-2 desync bug: the matrix leg must pass `--propose` so
		// the integration mode is TIED to the matrix shape the dispatch input picked
		// (it can never fall back to a repo config default of `merge`).
		expect(
			/advance-propose:[\s\S]*?agent-runner advance "?\$\{\{\s*matrix\.[\s\S]*?--propose\b/.test(
				text,
			),
		).toBe(true);
		// And `--merge` must NEVER ride a matrix leg (parallel merge-to-main thrash).
		expect(
			/agent-runner advance "?\$\{\{\s*matrix\.[^\n]*--merge\b/.test(text),
		).toBe(false);
	});

	it('merge mode is a SINGLE SEQUENTIAL job invoking the -n driver with --merge (no matrix)', () => {
		const text = loadAdvanceCiTemplate();
		// The `-n` driver is always sequential; the merge job must not use a matrix
		// (parallel merge jobs would thrash the main-CAS).
		expect(/agent-runner advance -n\b/.test(text)).toBe(true);
		expect(/advance-merge:[\s\S]*?strategy:\s*[\s\S]*?matrix:/.test(text)).toBe(
			false,
		);
		// The sequential job carries `--merge` so its integration mode is TIED to the
		// single-sequential shape (cannot desync from the dispatch mode / config).
		expect(/agent-runner advance -n\b[^\n]*--merge\b/.test(text)).toBe(true);
	});

	it('uses ONE word (integrationMode) for the dispatch input that drives BOTH flag and shape', () => {
		const text = loadAdvanceCiTemplate();
		// Vocabulary reconciliation: the dispatch input is `integrationMode` (the same
		// vocabulary as `.agent-runner.json`'s `integration` and `advance --propose`/
		// `--merge`), driving BOTH the flag the legs pass and the derived job shape —
		// not a second, independent `mode` knob that could disagree with the flag.
		expect(text).toContain('integrationMode:');
		expect(/github\.event\.inputs\.integrationMode/.test(text)).toBe(true);
	});

	it('only INVOKES the existing advance driver (not entangled with the tick)', () => {
		const text = loadAdvanceCiTemplate();
		expect(text).toContain('agent-runner advance');
	});

	it(
		'the propose `enumerate` `jq` UNIONS sliceable PRDs into the matrix as ' +
			'`prd:<slug>` legs alongside the slice legs (the ' +
			'`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices` fix)',
		() => {
			const text = loadAdvanceCiTemplate();
			// The slice-only jq this fix replaced left `AGENT_RUNNER_AUTO_SLICE` dead on
			// the hourly cron — a ready ungated PRD never became a matrix leg. The new jq
			// must read `scan --json`'s sliceable-PRD pool (`repos[].prds[]` +
			// `cwd.repo.prds[]`) and emit `prd:<slug>` legs alongside `slice:<slug>`.
			expect(/"slice:" \+ \.slug/.test(text)).toBe(true);
			expect(/"prd:" \+ \.slug/.test(text)).toBe(true);
			expect(/\.repos\[\]\.prds\[\]\?/.test(text)).toBe(true);
			expect(/\.cwd\.repo\.prds\[\]\?/.test(text)).toBe(true);
		},
	);

	describe('validateAdvanceCiTemplate flags a template missing each invariant', () => {
		const base = loadAdvanceCiTemplate();

		const withTmpTemplate = (
			text: string,
		): ReturnType<typeof validateAdvanceCiTemplate> => {
			const dir = mkdtempSync(join(tmpdir(), 'advance-ci-template-'));
			try {
				const path = join(dir, 'advance-loop.yml.template');
				writeFileSync(path, text, 'utf8');
				const loaded = loadAdvanceCiTemplate(path);
				return validateAdvanceCiTemplate(loaded);
			} finally {
				rmSync(dir, {recursive: true, force: true});
			}
		};

		it('flags a missing cron trigger', () => {
			const broken = base.replace(/-\s*cron:.*$/m, '# (cron removed)');
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain('trigger-cron');
		});

		it('flags a missing on-answer-committed trigger', () => {
			const broken = base.replace(
				/work\/questions\/\*\*/g,
				'work/tasks/todo/**',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'trigger-on-answer-committed',
			);
		});

		it('flags a missing scan-based matrix enumeration', () => {
			const broken = base.replace(/agent-runner scan --json/g, 'echo nope');
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'propose-enumerates-via-scan',
			);
		});

		it('flags a missing sequential -n merge driver', () => {
			const broken = base.replace(
				/agent-runner advance -n\b/g,
				'agent-runner advance',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'merge-sequential-n-driver',
			);
		});

		it('flags a propose matrix leg missing the --propose flag', () => {
			// Drop `--propose` from the matrix leg only: the integration mode would then
			// fall back to config and could desync from the matrix shape.
			const broken = base.replace(
				/(agent-runner advance "?\$\{\{\s*matrix\.item\s*\}\}"?) --propose/,
				'$1',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'propose-leg-carries-propose-flag',
			);
		});

		it('flags a merge -n job missing the --merge flag', () => {
			const broken = base.replace(/(agent-runner advance -n 10) --merge/, '$1');
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'merge-job-carries-merge-flag',
			);
		});

		it(
			'flags a regression to a SLICE-ONLY `jq` (no `prd:` legs) — the ' +
				'sliceable-PRD pool must be enumerated',
			() => {
				// Strip the PRD union from the jq: a slice-only enumerator would silently
				// kill auto-slice on the hourly cron (the exact pre-fix bug).
				const broken = base
					.replace(/"prd:" \+ \.slug/g, '"slice:" + .slug')
					.replace(/\.repos\[\]\.prds\[\]\?/g, '.repos[].items[]?')
					.replace(/\.cwd\.repo\.prds\[\]\?/g, '.cwd.repo.items[]?');
				const result = withTmpTemplate(broken);
				expect(result.ok).toBe(false);
				expect(result.problems.map((p) => p.id)).toContain(
					'propose-enumerates-sliceable-prds',
				);
			},
		);

		it('flags --merge riding a matrix leg (parallel merge-to-main thrash)', () => {
			// Inject a forbidden `--merge` onto the matrix leg: the validator must catch
			// that a parallel matrix could merge to main concurrently.
			const broken = base.replace(
				/(agent-runner advance "?\$\{\{\s*matrix\.item\s*\}\}"?) --propose/,
				'$1 --merge',
			);
			const result = withTmpTemplate(broken);
			expect(result.ok).toBe(false);
			expect(result.problems.map((p) => p.id)).toContain(
				'merge-flag-not-on-matrix-leg',
			);
		});
	});
});
