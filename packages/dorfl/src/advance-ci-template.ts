import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The CI-integration deliverable for the `advance` loop (prd `advance-loop`,
 * task `advance-install-ci`, US #27/28): the advance-loop CAPABILITY as a
 * DOCUMENTED workflow TEMPLATE (not a CLI subcommand; see the task's `##
 * Decisions`). The template at `docs/ci/advance-loop.yml.template` wires "on cron
 * / on-answer-committed, run the RIGHT shape" and only INVOKES the existing
 * `advance` driver; it is NOT entangled with the tick.
 *
 * The unified, per-capability `install-ci` CLI (auth/secrets wizard + GitHub
 * adapter) is owned by the separate `runner-in-ci` prd
 * (`work/prds/tasked/runner-in-ci.md`); when built it EMITS this template as its
 * advance-loop capability. This module's job is unchanged either way: locate +
 * STRUCTURALLY VALIDATE the template, so its shape is a contract the CLI can
 * safely emit (see `docs/ci/README.md` "Relationship to the `install-ci` CLI").
 *
 * This module locates + reads that template and STRUCTURALLY VALIDATES it. The
 * package depends on NO YAML library (see `frontmatter.ts` for the same
 * constraint), so {@link validateAdvanceCiTemplate} checks the small set of
 * invariants the task's acceptance criteria require directly:
 *
 *   - triggers on a CRON schedule AND on-answer-committed (a push touching
 *     `work/questions/**`);
 *   - `propose` mode → a MATRIX of independent jobs enumerated via the
 *     mirror-side pool scan (`dorfl scan --json`), one `advance … --propose`
 *     per item (the `--propose` flag TIES the integration mode to the matrix shape,
 *     so a leg can never merge to main);
 *   - `merge` mode → a MATRIX of independent jobs (one per item), each leg
 *     running `dorfl advance <item> --merge` so build/gate/review run
 *     concurrently across siblings; the LAND TAIL is serialised by the engine's
 *     `mergeRetries` CAS-retry loop (the git-alone floor), NOT by this
 *     workflow's job shape — a host-specific `concurrency:` group would be
 *     load-bearing for safety, which the floor framing forbids;
 *   - the dispatch input is `integrationMode` (ONE word, ONE meaning): it drives
 *     BOTH the integration flag the legs pass AND the job shape, so they cannot
 *     desync;
 *   - it references the EXISTING `advance` driver only (no new execution model);
 *   - it is a `.template` (so it never self-triggers in THIS repo).
 *
 * The check is deliberately a set of presence/shape assertions over the raw text
 * rather than a full YAML parse — it is the dependency-free counterpart of "the
 * template parses + references the right driver invocations" the task asks for.
 */

/** A single structural problem found in the template. */
export interface AdvanceCiTemplateProblem {
	/** A short, stable id for the violated invariant (for tests/assertions). */
	id: string;
	/** Human-readable description of what is missing or wrong. */
	message: string;
}

/** The result of {@link validateAdvanceCiTemplate}. */
export interface AdvanceCiTemplateValidation {
	/** True iff the template satisfies EVERY structural invariant. */
	ok: boolean;
	/** Each violated invariant (empty when `ok`). */
	problems: AdvanceCiTemplateProblem[];
}

/**
 * Locate the workflow template `docs/ci/advance-loop.yml.template`. It is a
 * REPO doc (the maintainer copies it into a consumer's `.github/workflows/`), so
 * it is resolved relative to this source file's monorepo position — the same
 * dev-monorepo walk `resolveProtocolDoc`'s last candidates use. `override`
 * short-circuits for tests / unusual layouts.
 */
export function resolveAdvanceCiTemplatePath(override?: string): string {
	if (override) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	// here = .../packages/dorfl/{src,dist}; the doc lives at the monorepo
	// root under docs/ci/. Walk up to the root from either src/ or dist/.
	const candidates = [
		resolve(here, '..', '..', '..', 'docs', 'ci', 'advance-loop.yml.template'),
		resolve(
			here,
			'..',
			'..',
			'..',
			'..',
			'docs',
			'ci',
			'advance-loop.yml.template',
		),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	// Fall back to the first candidate so the error names the expected path.
	return candidates[0];
}

/** Read the raw template text. Throws (ENOENT) if it cannot be located. */
export function loadAdvanceCiTemplate(override?: string): string {
	return readFileSync(resolveAdvanceCiTemplatePath(override), 'utf8');
}

/**
 * Structurally validate the advance-loop CI workflow template against the task's
 * acceptance criteria. Dependency-free (no YAML lib): a set of presence/shape
 * assertions over the raw text.
 */
export function validateAdvanceCiTemplate(
	text: string,
): AdvanceCiTemplateValidation {
	const problems: AdvanceCiTemplateProblem[] = [];
	const require = (id: string, present: boolean, message: string): void => {
		if (!present) {
			problems.push({id, message});
		}
	};

	// --- Triggers: cron AND on-answer-committed ---------------------------------
	require('trigger-cron', /\bschedule:\s*[\s\S]*?-\s*cron:/.test(
		text,
	), 'must trigger on a cron schedule (`on.schedule[].cron`).');
	require('trigger-on-answer-committed', /\bpush:\s*[\s\S]*?paths:[\s\S]*?work\/questions\//.test(
		text,
	), 'must trigger on-answer-committed (a push touching `work/questions/**`).');

	// --- propose ⇒ a MATRIX enumerated via the mirror-side pool scan -------------
	require('propose-matrix', /strategy:\s*[\s\S]*?matrix:/.test(
		text,
	), '`propose` mode must emit a MATRIX of jobs (`strategy.matrix`).');
	require('propose-enumerates-via-scan', /dorfl scan --json/.test(
		text,
	), 'the matrix items must be ENUMERATED via the mirror-side pool scan ' +
		'(`dorfl scan --json`).');
	// The `enumerate` `jq` must UNION taskable prds into the matrix
	// (`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`): a
	// task-only `jq` would render `DORFL_AUTO_TASK` dead on the hourly
	// cron — a ready ungated PRD would never become a matrix leg. The `jq` must
	// read `scan --json`'s taskable-SPEC pool (`repos[].specs[]` + `cwd.repo.specs[]`)
	// and emit `prd:<slug>` legs alongside the `task:<slug>` legs.
	require('propose-enumerates-taskable-specs', /"prd:" \+ \.slug/.test(text) &&
		/\.specs\[\]/.test(
			text,
		), 'the propose-mode `enumerate` `jq` must union taskable specs into the ' +
		"matrix as `prd:<slug>` legs (read from `scan --json`'s `repos[].specs[]` " +
		'+ `cwd.repo.specs[]` pools), so a ready ungated SPEC becomes one auto-task ' +
		'matrix leg alongside the eligible-task legs ' +
		'(`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`).');
	require('propose-one-advance-per-item', /dorfl advance "?\$\{\{\s*matrix\./.test(
		text,
	), 'each matrix leg must run one `dorfl advance <matrix item>` ' +
		'(one PR per item).');
	// The matrix leg must carry `--propose` so the integration mode is TIED to the
	// matrix shape (it cannot desync from the dispatch `integrationMode` input nor
	// fall back to a repo config default of `merge`). Scoped to the `advance-propose`
	// job so it is the LEG that carries it, not merely the file somewhere.
	require('propose-leg-carries-propose-flag', /advance-propose:[\s\S]*?dorfl advance "?\$\{\{\s*matrix\.[\s\S]*?--propose\b/.test(
		text,
	), 'each `propose` matrix leg must pass `--propose` so the integration mode is ' +
		'TIED to the matrix shape (a leg can never merge to main / desync from the ' +
		'dispatch mode).');

	// --- merge ⇒ a MATRIX per item (parallel build/gate/review, serialised land) -
	// The engine's `integrateLock` + `mergeRetries` CAS-retry loop is what makes
	// concurrent merge jobs LAND-SAFE (`land-time-reverify-and-parallel-merge-ceiling`):
	// build/gate/review fan out across siblings, and a non-fast-forward push
	// triggers re-rebase + re-gate + retry up to the resolved `mergeRetries` cap.
	// The cross-job serialiser is the CAS-retry loop itself — the git-alone floor.
	require('merge-matrix', /advance-merge:[\s\S]*?strategy:\s*[\s\S]*?matrix:/.test(
		text,
	), 'the `merge` job must use a MATRIX (parallel build/gate/review per item; ' +
		"the land tail is serialised by the engine's `mergeRetries` CAS-retry " +
		"loop, not by the workflow's job shape).");
	// Each merge matrix leg must run one `dorfl advance <matrix.item> --merge`,
	// scoped to the `advance-merge:` job so the `--merge` flag is TIED to its leg
	// (cannot desync from the dispatch `integrationMode` input nor fall back to a
	// repo config default of `propose`).
	require('merge-leg-carries-merge-flag', /advance-merge:[\s\S]*?dorfl advance "?\$\{\{\s*matrix\.[\s\S]*?--merge\b/.test(
		text,
	), 'each `merge` matrix leg must pass `--merge` so the integration mode is ' +
		'TIED to the matrix shape (a leg can never propose-only / desync from the ' +
		'dispatch mode).');
	// The merge fan-out is the SAFETY-FLOOR shape: no `concurrency:` group on the
	// `advance-merge:` job, because a GitHub Actions `concurrency:` serialiser
	// would be load-bearing for cross-job land safety, and the floor must work on
	// a bare arbiter with no host (Applied Answer q1: scaled CAS-retry is the
	// floor; the portable cross-job ref-lock is the planned accelerator; GitHub
	// `concurrency:` is OPTIONAL host sugar only, deliberately not used here).
	require('merge-no-host-concurrency-serialiser', !/advance-merge:[\s\S]*?\n\s{4}concurrency:/.test(
		text,
	), 'the `merge` job must NOT carry a `concurrency:` group: a host-specific ' +
		'serialiser would make the cross-job land safety depend on a GitHub Actions ' +
		"feature; the engine's `mergeRetries` CAS-retry loop is the git-alone " +
		'floor.');

	// --- It only INVOKES the existing `advance` driver (no new execution model) --
	require('invokes-advance-driver', /dorfl advance\b/.test(
		text,
	), 'the workflow must INVOKE the existing `advance` driver.');

	return {ok: problems.length === 0, problems};
}
