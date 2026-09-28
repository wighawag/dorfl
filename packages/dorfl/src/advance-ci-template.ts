import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The CI-integration deliverable for the `advance` loop (spec `advance-loop`,
 * task `advance-install-ci`, US #27/28): the advance-loop CAPABILITY as a
 * DOCUMENTED workflow TEMPLATE (not a CLI subcommand; see the task's `##
 * Decisions`). The template at `docs/ci/advance-loop.yml.template` wires "on cron
 * / on-answer-committed, run the RIGHT shape" and only INVOKES the existing
 * `advance` driver; it is NOT entangled with the tick.
 *
 * The unified, per-capability `install-ci` CLI (auth/secrets wizard + GitHub
 * adapter) is owned by the separate `runner-in-ci` spec
 * (`work/specs/tasked/runner-in-ci.md`); when built it EMITS this template as its
 * advance-loop capability. This module's job is unchanged either way: locate +
 * STRUCTURALLY VALIDATE the template, so its shape is a contract the CLI can
 * safely emit (see `docs/ci/README.md` "Relationship to the `install-ci` CLI").
 *
 * This module locates + reads that template and STRUCTURALLY VALIDATES it. The
 * package depends on NO YAML library (see `frontmatter.ts` for the same
 * constraint), so {@link validateAdvanceCiTemplate} checks the small set of
 * invariants the acceptance criteria require directly:
 *
 *   - triggers on a CRON schedule AND on-answer-committed (a push to `main`
 *     touching `work/questions/**`);
 *   - THE SPLIT (spec `ci-agent-job-without-write-token`, ADR
 *     `ci-agent-job-holds-no-write-token`, task `ci-split-generate-workflows`):
 *     the tick runs NO agent. `enumerate` lists the items via the pool scan
 *     (`dorfl scan --json`), and a `dispatch` job holding `actions: write` ONLY
 *     (no checkout, no setup) starts one `dorfl-item-dispatch.yml` run per item,
 *     which calls `dorfl-item.yml` (lock, agent, apply). No matrix: one item per
 *     workflow run, so no item shares another's artifact namespace;
 *   - the dispatch input is `integrationMode` (ONE word, ONE meaning): the
 *     `dispatch` job forwards it to every item run, which passes it to
 *     `advance` as `--propose`/`--merge`, so they cannot desync. In merge mode
 *     the LAND tail is serialised by the engine's `mergeRetries` CAS-retry loop
 *     in the item's apply job (the git-alone floor), NOT by a workflow
 *     `concurrency:` group; a lost CAS re-runs the rebase and the push only,
 *     never the gate (decision 2), and the apply phase reports it;
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

	// --- The pool scan enumerates the items ------------------------------------
	require('enumerates-via-scan', /dorfl scan --json/.test(
		text,
	), 'the items must be ENUMERATED via the mirror-side pool scan ' +
		'(`dorfl scan --json`).');
	// The `enumerate` `jq` must UNION taskable prds into the item list
	// (`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`): a
	// task-only `jq` would render `DORFL_AUTO_TASK` dead on the hourly cron.
	require('propose-enumerates-taskable-specs', /"spec:" \+ \.slug/.test(text) &&
		/\.specs\[\]/.test(
			text,
		), 'the `enumerate` `jq` must union taskable specs into the item list as ' +
		"`spec:<slug>` ids (read from `scan --json`'s `repos[].specs[]` " +
		'+ `cwd.repo.specs[]` pools), so a ready ungated SPEC becomes one auto-task ' +
		'item run alongside the eligible-task items ' +
		'(`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`).');

	// --- THE SPLIT: one dorfl-item run per item, dispatched, never a matrix -----
	require('no-matrix', !/\bstrategy:\s*[\s\S]*?matrix:/.test(
		text,
	), 'no job may use a `strategy.matrix`: one item per workflow run (a matrix ' +
		'shares one artifact namespace across items; decision 1 of ADR ' +
		'ci-agent-job-holds-no-write-token).');
	require('dispatches-item-runs', /gh workflow run dorfl-item-dispatch\.yml\b/.test(
		text,
	), 'the `dispatch` job must start one `dorfl-item-dispatch.yml` run per item ' +
		'(which calls dorfl-item.yml: lock, agent, apply).');
	require('dispatch-actions-write-only', /\n {2}dispatch:[\s\S]*?\n {4}permissions:\s*\n {6}actions: write\s*\n {4}steps:/.test(
		text,
	), 'the `dispatch` job must hold `actions: write` and nothing else.');
	const dispatchJob =
		/\n {2}dispatch:[\s\S]*?(?=\n {2}[#\w]|$)/.exec(text)?.[0] ?? '';
	require('dispatch-no-checkout-no-setup', dispatchJob !== '' &&
		!/uses:/.test(
			dispatchJob,
		), 'the `dispatch` job must have NO checkout and NO setup (no repository ' +
		'code runs next to `actions: write`).');
	// ONE word: the dispatch job forwards `integrationMode` to every item run,
	// which passes it to `advance` as `--propose`/`--merge`.
	require('dispatch-forwards-integration-mode', /-f "integrationMode=\$\{INTEGRATION_MODE\}"/.test(
		text,
	) &&
		/INTEGRATION_MODE: \$\{\{ github\.event\.inputs\.integrationMode \|\| 'propose' \}\}/.test(
			text,
		), 'the `dispatch` job must forward the `integrationMode` dispatch input ' +
		"(default `propose`) to each item run, so the items' integration mode is " +
		'TIED to the tick.');
	require('dispatch-slot', /-f "slot=\$\{slot\}"/.test(
		text,
	), 'the `dispatch` job must give each item run a parallelism slot.');
	require('dispatch-skips-active-runs', /gh run list[^\n]*--workflow dorfl-item-dispatch\.yml[^\n]*displayTitle,status/.test(
		text,
	), 'the `dispatch` job must skip an item whose `dorfl-item <item>` run is ' +
		'not completed yet.');
	// The item id may be hand-written, so it must reach the shell as DATA through
	// `env:`, never as `${{ }}` text spliced into the `run:` script.
	require('items-not-spliced-into-run', !/gh workflow run[^\n]*\$\{\{/.test(
		text,
	), 'the items must reach the dispatch script through `env:`, never as ' +
		'`${{ }}` text in the `run:` script (script injection).');
	// No host-specific serialiser on the land: a workflow-level `concurrency:`
	// group keyed on main would be load-bearing for cross-run land safety, which
	// the git-alone floor forbids (the slot groups live on the item runs and
	// only cap the parallelism).
	require('permissions-empty', /^permissions: \{\}$/m.test(
		text,
	), 'the workflow must grant nothing at workflow level (`permissions: {}`).');
	require('push-pinned-to-main', /\bpush:\s*\n\s+(?:#[^\n]*\n\s+)*branches:\s*\n\s+-\s*main\b/.test(
		text,
	), 'the on-answer-committed `push` trigger must be pinned to `main`.');

	// --- It only INVOKES the existing `advance` driver (no new execution model) --
	// The driver runs inside the per-item workflow: the template names it in the
	// comments and must not run any agent verb itself.
	require('invokes-advance-driver', /\badvance\b/.test(text) &&
		!/^\s*[^#\n]*dorfl (?:advance|do|intake|run)\b/m.test(
			text,
		), 'the workflow must reach the existing `advance` driver through the ' +
		'per-item workflow, and run no agent verb itself.');

	return {ok: problems.length === 0, problems};
}
