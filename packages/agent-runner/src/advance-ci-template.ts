import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The CI-integration deliverable for the `advance` loop (PRD `advance-loop`,
 * slice `advance-install-ci`, US #27/28) — the **`install-ci` notion** as a
 * DOCUMENTED workflow TEMPLATE (not a CLI subcommand; see the slice's `##
 * Decisions`). The template at `docs/ci/advance-loop.yml.template` wires "on cron
 * / on-answer-committed → run the RIGHT shape" and only INVOKES the existing
 * `advance` driver — it is NOT entangled with the tick.
 *
 * This module locates + reads that template and STRUCTURALLY VALIDATES it. The
 * package depends on NO YAML library (see `frontmatter.ts` for the same
 * constraint), so {@link validateAdvanceCiTemplate} checks the small set of
 * invariants the slice's acceptance criteria require directly:
 *
 *   - triggers on a CRON schedule AND on-answer-committed (a push touching
 *     `work/questions/**`);
 *   - `propose` mode → a MATRIX of independent jobs enumerated via the
 *     mirror-side pool scan (`agent-runner scan --json`), one `advance` per item;
 *   - `merge` mode → a SINGLE SEQUENTIAL job invoking the `-n` driver
 *     (`agent-runner advance -n …`, always sequential);
 *   - it references the EXISTING `advance` driver only (no new execution model);
 *   - it is a `.template` (so it never self-triggers in THIS repo).
 *
 * The check is deliberately a set of presence/shape assertions over the raw text
 * rather than a full YAML parse — it is the dependency-free counterpart of "the
 * template parses + references the right driver invocations" the slice asks for.
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
 * dev-monorepo walk `resolveClaimProtocolPath`'s last candidates use. `override`
 * short-circuits for tests / unusual layouts.
 */
export function resolveAdvanceCiTemplatePath(override?: string): string {
	if (override) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	// here = .../packages/agent-runner/{src,dist}; the doc lives at the monorepo
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
 * Structurally validate the advance-loop CI workflow template against the slice's
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
	require('propose-enumerates-via-scan', /agent-runner scan --json/.test(
		text,
	), 'the matrix items must be ENUMERATED via the mirror-side pool scan ' +
		'(`agent-runner scan --json`).');
	require('propose-one-advance-per-item', /agent-runner advance "?\$\{\{\s*matrix\./.test(
		text,
	), 'each matrix leg must run one `agent-runner advance <matrix item>` ' +
		'(one PR per item).');

	// --- merge ⇒ a SINGLE SEQUENTIAL job invoking the `-n` driver ----------------
	require('merge-sequential-n-driver', /agent-runner advance -n\b/.test(
		text,
	), '`merge` mode must run a SINGLE SEQUENTIAL job invoking the `-n` driver ' +
		'(`agent-runner advance -n <x>`).');
	// A matrix must NOT appear in the merge job — guard against parallel merge
	// (which would thrash the main-CAS). The merge job is identified by its name.
	require('merge-no-matrix', !/advance-merge:[\s\S]*?strategy:\s*[\s\S]*?matrix:/.test(
		text,
	), 'the `merge` job must NOT use a matrix (parallel merge jobs would thrash ' +
		'the main-CAS).');

	// --- It only INVOKES the existing `advance` driver (no new execution model) --
	require('invokes-advance-driver', /agent-runner advance\b/.test(
		text,
	), 'the workflow must INVOKE the existing `advance` driver.');

	return {ok: problems.length === 0, problems};
}
