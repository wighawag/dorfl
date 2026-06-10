import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {runAsync, type RunResult} from './git.js';
import {paramCase} from './brand.js';
import {
	performIntegration,
	type IntegrationCoreResult,
} from './integration-core.js';
import {integrationFromFlags} from './complete.js';
import type {IntegrationMode, ReviewProviderName} from './config.js';
import {NullHarness, type Harness} from './harness.js';
import {launchWithOptionalWatch} from './agent-launch.js';
import {
	GitHubIssueProvider,
	PROCESSING_LOCK_LABEL,
	type Issue,
	type IssueComment,
	type IssueProvider,
} from './issue-provider.js';
import {extractJsonObjectSpan} from './verdict-json.js';

/**
 * **`intake <N>`** (PRD `issue-intake`, slice `intake-tracer-slice-outcome`): the
 * KEYSTONE of the issue front-door. A new, GATE-FREE command — explicit invocation
 * IS the authorization (precedent: `explicit-do-prd-not-gated-by-autoslice`), so
 * `autoSlice`/`autoBuild` config does NOT apply — that reads a GitHub issue + its
 * thread through the {@link IssueProvider} seam, runs the decision as a
 * **prompt → VERDICT**, and DISPATCHES on the verdict.
 *
 * The engine shape MIRRORS the review gate (prompt → `approve|block` → dispatch):
 * the decision prompt is an INLINE builder ({@link buildIntakeDecisionBrief}, like
 * `buildSlicingBrief`); the **dispatcher is the testable seam** — a STUBBED verdict
 * (injected, no model/network) drives it, exactly as `ReviewGate` is injected. The
 * prompt's JUDGEMENT is NOT unit-tested (like the review prompt's is not); only the
 * dispatch is.
 *
 * The dispatcher implements the FULL four-outcome decision table (PRD
 * `issue-intake` — the source of truth):
 * - **ASK** (not clear enough to act on): `postIssueComment` the next clarifying
 *   question; emit NOTHING; STOP.
 * - **SLICE** (clear AND fits ONE tracer-bullet slice): write
 *   `work/backlog/<slug>.md` (`covers: []`, NO `prd:`) carrying `issue: N` (the
 *   lone-slice closure link, NOT `Fixes #N`), integrate via {@link
 *   performIntegration} (default `propose`).
 * - **PRD** (clear AND coherent but >1 slice — INCLUDING a coupled-but-SMALL pair,
 *   which is NEVER bounced): write `work/prd/<slug>.md` with `issue: N` (+ the gate
 *   axes the verdict carried), integrate, STOP (slicing is the separate `do prd:`
 *   step).
 * - **BOUNCE** (genuinely UNRELATED concerns — no shared vision): `postIssueComment`
 *   "file separate issues"; emit NOTHING; leave the issue OPEN (closing is CI's
 *   close JOB, never `intake`'s).
 *
 * The per-outcome integration KNOBS, the processing LOCK, and event-classification
 * are LATER slices and are NOT built here (default `propose` is fine here).
 *
 * The AGENT only DRAFTS (returns the verdict object); the RUNNER (this dispatcher)
 * owns every git/seam side-effect — the write + integrate (and, in later slices,
 * the comment + label ops). The agent is git-free AND seam-free: the in-band
 * boundary (the SAME discipline the build/slicer agents follow).
 */

/** The four outcomes the decision prompt classifies an issue into (the decision table). */
export type IntakeOutcome = 'ask' | 'slice' | 'prd' | 'bounce';

/**
 * The VERDICT the decision prompt returns — `{ask,slice,prd,bounce}` + the drafted
 * content for the chosen outcome. THIS slice consumes only the `slice` branch's
 * fields (`sliceSlug` / `sliceTitle` / `sliceBody`); the `ask`/`prd`/`bounce`
 * fields are carried on the shape (so the type is stable for the next slice) but
 * not dispatched here.
 */
export interface IntakeVerdict {
	/** Which outcome the prompt chose for the issue. */
	outcome: IntakeOutcome;
	/**
	 * The drafted slice's content-derived slug (`slice` outcome). The dispatcher
	 * SANITISES it (a content-derived slug, never a counter) before writing
	 * `work/backlog/<slug>.md`. Falls back to a slug derived from {@link sliceTitle}
	 * when absent/empty.
	 */
	sliceSlug?: string;
	/** The drafted slice's `title:` (`slice` outcome). */
	sliceTitle?: string;
	/**
	 * The drafted slice BODY (`slice` outcome) — the markdown AFTER the frontmatter
	 * (the `## What to build` / `## Acceptance criteria` / `## Prompt` sections). The
	 * dispatcher writes the frontmatter (slug/title/`covers: []`, NO `prd:`) carrying
	 * the lone-slice `issue: N` closure link itself; the agent never writes
	 * git-visible files.
	 */
	sliceBody?: string;
	/**
	 * The drafted clarifying question (`ask` outcome) — the dispatcher posts it via
	 * `postIssueComment`, emits nothing, and STOPS (a later run resumes from the
	 * updated thread).
	 */
	question?: string;
	/**
	 * The drafted PRD's content-derived slug (`prd` outcome). The dispatcher
	 * SANITISES it through `paramCase` (never a counter) before writing
	 * `work/prd/<slug>.md`. Falls back to a slug derived from {@link prdTitle} when
	 * absent/empty.
	 */
	prdSlug?: string;
	/** The drafted PRD's `title:` (`prd` outcome). */
	prdTitle?: string;
	/**
	 * The drafted PRD BODY (`prd` outcome) — the markdown AFTER the frontmatter
	 * (`## Problem Statement` / `## Solution` / `## User Stories` / …). The dispatcher
	 * writes the frontmatter (title/slug/`issue: N` + the gate axes) itself; the
	 * agent never writes git-visible files.
	 */
	prdBody?: string;
	/**
	 * The PRD's gate axes (`prd` outcome) AS THE PROMPT JUDGED THEM — surfaced onto
	 * the emitted `work/prd/<slug>.md` frontmatter (PRD US #8: "the emitted artifact
	 * carries … its own gate axes"). Both omitted (undeclared) by default; the prompt
	 * sets `prdHumanOnly: true` when a human should drive the SLICING and/or
	 * `prdNeedsAnswers: true` when open questions remain.
	 */
	prdHumanOnly?: boolean;
	prdNeedsAnswers?: boolean;
	/**
	 * The drafted bounce message (`bounce` outcome) — the dispatcher posts it via
	 * `postIssueComment` ("please file separate issues"), emits nothing, and leaves
	 * the issue OPEN (no close; closing is CI's close JOB).
	 */
	bounceMessage?: string;
}

/** The terminal status of one `intake <N>` run. */
export type IntakeRunOutcome =
	| 'sliced' // a `slice` verdict → backlog slice written + integrated
	| 'asked' // an `ask` verdict → clarifying question posted, nothing emitted
	| 'prd' // a `prd` verdict → `work/prd/<slug>.md` written + integrated
	| 'bounced' // a `bounce` verdict → split-issues comment posted, nothing emitted
	| 'locked' // the `processing` lock was already held → backed off (did nothing)
	| 'lock-failed' // the lock could not be ACQUIRED on a label-supporting provider → fail (do NOT proceed lock-less)
	| 'agent-failed' // the decision agent invocation itself errored
	| 'stale' // the integrate rebase conflicted against an advanced main
	| 'usage-error'; // usage / environment problem

export interface IntakeResult {
	exitCode: 0 | 1 | 4;
	outcome: IntakeRunOutcome;
	/** The issue number acted on. */
	issueNumber: number;
	/** The slug of the emitted artifact (slice OR prd outcome). */
	emittedSlug?: string;
	/** Repo-relative path of the emitted artifact (slice OR prd outcome). */
	emitted?: string;
	/** True iff a comment was posted on the issue (ask / bounce outcomes). */
	commented?: boolean;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/**
 * The DECISION step: given the issue + thread, return a VERDICT. Tests inject a
 * canned verdict (the STUBBED seam that drives the dispatcher, no model/network).
 * Production wires the harness through {@link harnessIntakeDecision}.
 */
export type IntakeDecider = (input: {
	cwd: string;
	issue: Issue;
	comments: IssueComment[];
	prompt: string;
	env?: NodeJS.ProcessEnv;
}) => Promise<IntakeVerdict>;

export interface PerformIntakeOptions {
	/** The issue number to intake (`intake <N>`). */
	issueNumber: number;
	/** The working clone/checkout the intake runs in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/**
	 * The issue seam (read the issue + thread). Tests inject a STUB; production
	 * defaults to {@link GitHubIssueProvider} (the only place `gh` is shelled out).
	 */
	issueProvider?: IssueProvider;
	/**
	 * The DECISION seam (prompt → verdict). Tests inject a CANNED verdict (no
	 * model/network) — this is the unit-test target. Production wires the harness.
	 */
	decide?: IntakeDecider;
	/** The harness seam used when {@link decide} is omitted; defaults to the null adapter. */
	harness?: Harness;
	/** The configured agent command the harness shells out to (null adapter). */
	agentCmd?: string;
	/** The model routing intent forwarded to the harness (ADR §13). */
	model?: string;
	/** The HOST-ONLY sessions root for the pi session file. */
	sessionsDir?: string;
	/**
	 * The PER-OUTCOME integration modes (PRD US #9) the emitted artifact integrates
	 * THROUGH the shared core with. Because `intake` decides the artifact TYPE at
	 * RUNTIME, the mode is keyed per type: an emitted slice integrates with
	 * `integration.slice`, an emitted PRD with `integration.prd` (`propose` =
	 * push the `work/<slug>` branch + open a PR, NO `main` touch; `merge` = land on
	 * `main`). The CLI resolves this from the granular + aggregate flags via
	 * {@link resolveIntakeIntegrationModes}; ask/bounce emit nothing, so the modes
	 * are no-ops for them. Unset ⇒ propose for both.
	 */
	integration?: IntakeIntegrationModes;
	/** The review-request provider override (propose mode); auto-detect when unset. */
	provider?: ReviewProviderName;
	/** Environment for child git/agent processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

const DEFAULT_ARBITER = 'origin';

/**
 * The emitted artifact TYPE `intake` decides at RUNTIME — a `slice` verdict emits
 * `work/backlog/<slug>.md`, a `prd` verdict emits `work/prd/<slug>.md`. The two
 * granular flag axes (`--merge-slice`/`--propose-slice` vs `--merge-prd`/
 * `--propose-prd`) are keyed on this. (ask/bounce emit NOTHING, so the modes are
 * no-ops for them.)
 */
export type IntakeArtifactType = 'slice' | 'prd';

/**
 * The PER-OUTCOME integration mode FLAG SET (PRD `issue-intake` US #9). Because
 * `intake` decides the artifact TYPE at runtime, a single `--merge`/`--propose`
 * cannot express a type-conditional policy ("merge a PRD but propose a slice") —
 * hence the four GRANULAR per-type flags layered over the two AGGREGATES:
 *
 * - **granular:** `--merge-prd`/`--propose-prd` apply iff the outcome is a PRD;
 *   `--merge-slice`/`--propose-slice` apply iff it is a slice.
 * - **aggregates:** `--merge` = merge BOTH types; `--propose` = propose BOTH.
 *
 * `intake` owns only these KNOBS; WHICH knobs CI sets (from gate state +
 * author-trust) is CI's POLICY, authored in `runner-in-ci` — NOT here.
 */
export interface IntakeIntegrationFlags {
	/** Aggregate: merge BOTH a slice and a PRD (the broad knob, overridden per type). */
	merge?: boolean;
	/** Aggregate: propose BOTH a slice and a PRD. */
	propose?: boolean;
	/** Granular: merge a PRD (overrides the aggregate for the PRD outcome). */
	mergePrd?: boolean;
	/** Granular: propose a PRD (overrides the aggregate for the PRD outcome). */
	proposePrd?: boolean;
	/** Granular: merge a slice (overrides the aggregate for the slice outcome). */
	mergeSlice?: boolean;
	/** Granular: propose a slice (overrides the aggregate for the slice outcome). */
	proposeSlice?: boolean;
}

/** Both per-type integration modes, resolved from the flag set in ONE eager pass. */
export interface IntakeIntegrationModes {
	/** The mode an EMITTED slice integrates with. */
	slice: IntegrationMode;
	/** The mode an EMITTED PRD integrates with. */
	prd: IntegrationMode;
}

/** Default per-outcome integration mode when no flag selects one — propose (matches `do`). */
const DEFAULT_INTEGRATION: IntegrationMode = 'propose';

/**
 * Resolve the GRANULAR per-type axis (`--merge-<t>` / `--propose-<t>`) for ONE
 * artifact type, REUSING {@link integrationFromFlags} for its mutual-exclusion +
 * "mutually exclusive" error message (the same-type-both usage error) — so the
 * granular axis is NOT a forked second resolver, just `integrationFromFlags`
 * applied to the per-type pair. Returns the granular mode, or `undefined` when
 * neither granular flag for this type was given (the aggregate/default then
 * decides). The error message is reworded to name the granular flag pair.
 */
function granularFromFlags(
	type: IntakeArtifactType,
	merge: boolean | undefined,
	propose: boolean | undefined,
): IntegrationMode | undefined {
	try {
		return integrationFromFlags({merge, propose});
	} catch {
		throw new Error(
			`--merge-${type} and --propose-${type} are mutually exclusive; pass at most one.`,
		);
	}
}

/**
 * The PURE per-outcome integration mode resolution (PRD `issue-intake` US #9 —
 * the canonical table). Given ONLY the flag set, resolve BOTH per-type modes in
 * one eager pass (so a usage error is caught before the runtime verdict is even
 * known). The rules, all decided in the PRD:
 *
 * - **unset ⇒ propose for BOTH** (conservative default; matches `do`).
 * - **aggregates:** `--merge` ⇒ merge both; `--propose` ⇒ propose both (this axis
 *   COMPOSES the existing {@link integrationFromFlags}, reusing its mutual
 *   exclusion + error message).
 * - **granular routes per type:** `--merge-prd` merges a PRD (and leaves a slice at
 *   the aggregate/default), etc.
 * - **GRANULAR OVERRIDES AGGREGATE:** `--merge --propose-slice` ⇒ merge a PRD,
 *   propose a slice.
 * - **same type + both modes is a usage ERROR:** `--merge-prd --propose-prd` (and
 *   `--merge-slice --propose-slice`), and the aggregate `--merge --propose`.
 *
 * Throws (a usage error) on any mutually-exclusive pair. The dispatcher picks the
 * field matching the runtime verdict's type; ask/bounce never integrate, so the
 * modes are no-ops for them.
 *
 * `defaultMode` is the FALLBACK when NEITHER a granular nor the aggregate flag
 * selects a mode for a type — it defaults to `propose` (so the pure table reads
 * "unset ⇒ propose for both"), but the CLI passes the per-repo/global
 * config-resolved mode so the established precedence chain (flag > per-repo >
 * global > default) is preserved, exactly as `do`/`complete` resolve it.
 */
export function resolveIntakeIntegrationModes(
	flags: IntakeIntegrationFlags,
	defaultMode: IntegrationMode = DEFAULT_INTEGRATION,
): IntakeIntegrationModes {
	// AGGREGATE axis — reuse the existing resolver (its mutual exclusion + the
	// "--merge and --propose are mutually exclusive" message). `undefined` ⇒ unset.
	const aggregate = integrationFromFlags({
		merge: flags.merge,
		propose: flags.propose,
	});
	// GRANULAR axes — `integrationFromFlags` per type (the same-type-both error).
	const prdGranular = granularFromFlags(
		'prd',
		flags.mergePrd,
		flags.proposePrd,
	);
	const sliceGranular = granularFromFlags(
		'slice',
		flags.mergeSlice,
		flags.proposeSlice,
	);
	// GRANULAR OVERRIDES AGGREGATE; aggregate over the (config/propose) default.
	return {
		prd: prdGranular ?? aggregate ?? defaultMode,
		slice: sliceGranular ?? aggregate ?? defaultMode,
	};
}

/**
 * Run `intake <N>` end-to-end (the LOCAL one-shot). Never throws for the expected
 * agent-failed / stale / usage cases — those are returned with the corresponding
 * exit code and outcome. The runner owns all git/seam side-effects; the agent only
 * DRAFTS the verdict.
 */
export async function performIntake(
	options: PerformIntakeOptions,
): Promise<IntakeResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env;
	const issueNumber = options.issueNumber;
	const issueProvider = options.issueProvider ?? new GitHubIssueProvider();

	// 1. READ the issue + thread via the seam (the core never imports `gh`; only the
	//    adapter shells out). A read failure surfaces as a usage error — `intake`
	//    cannot decide without the issue.
	let issue: Issue;
	let comments: IssueComment[];
	try {
		issue = await issueProvider.getIssue({cwd, issueNumber, env});
		comments = await issueProvider.listComments({cwd, issueNumber, env});
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		const message = `Could not read issue #${issueNumber}: ${detail}`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', issueNumber, message};
	}

	// 2. ACQUIRE the `processing` LOCK (PRD US #10): a TRANSIENT concurrency mutex
	//    that serialises two concurrent runs on the SAME issue. Read the labels; if
	//    the lock is ALREADY present, BACK OFF (do nothing — another run owns it). The
	//    winner ADDS the label and proceeds; the label is REMOVED on finish (success
	//    OR handled failure, in the `finally` below). It is NOT a `work/` CAS and NOT a
	//    label state-machine (ADR §12) — ONE transient lock label.
	//
	//    Fail-vs-degrade (maintainer decision): a lock that is MEANINGFUL but cannot
	//    be taken must NOT silently proceed lock-less. Only a genuinely-UNSUPPORTED
	//    provider (no label concept at all) legitimately degrades to best-effort (the
	//    spec's provider-pluggability; CI's per-issue concurrency group is then the
	//    only serialiser — out of scope here). A real FAILURE on a label-supporting
	//    provider (e.g. `gh` unauthenticated) FAILS the run with the REAL cause
	//    surfaced, rather than misattributing it or proceeding without serialisation.
	const labels = await issueProvider.getLabels({cwd, issueNumber, env});
	if (labels.outcome === 'failed') {
		// The provider HAS labels but we could not READ the lock state — we cannot tell
		// whether another run holds it, so guessing "free" could let two runs proceed.
		// FAIL with the real cause (the actual `gh` stderr), not a hard-coded guess.
		const message =
			`Intake of issue #${issueNumber} could not acquire the ` +
			`\`${PROCESSING_LOCK_LABEL}\` lock: ${labels.instruction}`;
		note(message);
		return {exitCode: 1, outcome: 'lock-failed', issueNumber, message};
	}
	if (
		labels.outcome === 'ok' &&
		labels.labels.includes(PROCESSING_LOCK_LABEL)
	) {
		const message =
			`Intake of issue #${issueNumber} backed off: the \`${PROCESSING_LOCK_LABEL}\` ` +
			`lock is already held by a concurrent run; doing nothing.`;
		note(message);
		return {exitCode: 0, outcome: 'locked', issueNumber, message};
	}
	let locked = false;
	if (labels.outcome === 'ok') {
		const acquired = await issueProvider.addLabel({
			cwd,
			issueNumber,
			label: PROCESSING_LOCK_LABEL,
			env,
		});
		if (acquired.outcome === 'failed') {
			// The provider HAS labels but the ACQUIRE failed for a real reason (e.g. `gh`
			// lost auth, or the label could not be created on a fresh repo). The lock is
			// meaningful but unacquirable → FAIL with the real cause, do NOT proceed
			// lock-less (which would let a concurrent run race us).
			const message =
				`Intake of issue #${issueNumber} could not acquire the ` +
				`\`${PROCESSING_LOCK_LABEL}\` lock: ${acquired.instruction}`;
			note(message);
			return {exitCode: 1, outcome: 'lock-failed', issueNumber, message};
		}
		locked = acquired.applied;
	} else {
		// Non-label provider (genuinely UNSUPPORTED) → the ONLY legitimate degrade:
		// proceed without the lock, surfaced honestly.
		note(`Processing lock degraded: ${labels.instruction}`);
	}

	// INTERRUPTION-SAFETY (maintainer point 3): the `finally` below releases on every
	// EXCEPTION path, but a SIGINT/SIGTERM (Ctrl-C, kill) unwinds the process WITHOUT
	// running `finally` — which would LEAK the lock label and block all future intake
	// runs on this issue. While the lock is held we install signal handlers that
	// release it best-effort before the process exits. A leaked lock must ALSO be
	// recoverable by hand and that recovery must be DISCOVERABLE, so we surface the
	// exact manual command (`gh issue edit <N> --remove-label <label>`) whenever the
	// best-effort release does not confirm.
	const manualRecovery =
		`If the \`${PROCESSING_LOCK_LABEL}\` lock is left behind, release it with: ` +
		`gh issue edit ${issueNumber} --remove-label '${PROCESSING_LOCK_LABEL}'`;
	const releaseLock = createLockReleaser({
		locked,
		issueProvider,
		cwd,
		issueNumber,
		env,
		note,
		manualRecovery,
	});
	const onSignal = (signal: NodeJS.Signals) => {
		// Synchronous best-effort release on interruption, then re-raise the default
		// disposition so the process still exits with the conventional signal code.
		if (locked) {
			note(
				`Received ${signal}; releasing the \`${PROCESSING_LOCK_LABEL}\` lock on issue #${issueNumber} before exit.`,
			);
		}
		releaseLock.releaseSync();
		process.removeListener('SIGINT', onSignal);
		process.removeListener('SIGTERM', onSignal);
		process.kill(process.pid, signal);
	};
	if (locked) {
		process.once('SIGINT', onSignal);
		process.once('SIGTERM', onSignal);
	}

	try {
		return await decideAndDispatch(options, cwd, issue, comments, {
			arbiter,
			issueProvider,
			note,
		});
	} finally {
		// RELEASE the lock on FINISH (success OR handled failure). Only the winner that
		// actually acquired it releases it — a degraded/best-effort run holds nothing.
		process.removeListener('SIGINT', onSignal);
		process.removeListener('SIGTERM', onSignal);
		await releaseLock.release();
	}
}

/**
 * Build the lock RELEASER for {@link performIntake}: one `release()` (the normal
 * async finish path) and one `releaseSync()` (the signal-handler path — a
 * best-effort synchronous release that must run inside a signal handler). Both are
 * no-ops when the run never held the lock (a degraded/unsupported run holds
 * nothing). When a release does not CONFIRM, the manual-recovery hint is surfaced
 * so a leaked lock stays recoverable AND discoverable (maintainer point 3).
 */
function createLockReleaser(params: {
	locked: boolean;
	issueProvider: IssueProvider;
	cwd: string;
	issueNumber: number;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
	manualRecovery: string;
}): {release: () => Promise<void>; releaseSync: () => void} {
	const {locked, issueProvider, cwd, issueNumber, env, note, manualRecovery} =
		params;
	let released = false;
	const surfaceFailure = (instruction: string) => {
		note(`Processing lock release degraded: ${instruction}`);
		note(manualRecovery);
	};
	return {
		async release() {
			if (!locked || released) {
				return;
			}
			released = true;
			const result = await issueProvider.removeLabel({
				cwd,
				issueNumber,
				label: PROCESSING_LOCK_LABEL,
				env,
			});
			if (!result.applied) {
				surfaceFailure(result.instruction);
			}
		},
		releaseSync() {
			if (!locked || released) {
				return;
			}
			released = true;
			// A signal handler cannot await. The GitHub adapter's `removeLabel` shells out
			// SYNCHRONOUSLY (spawnSync) inside its async wrapper, so firing it here still
			// runs the `gh` call before the process exits — but we cannot READ the result
			// synchronously through the async seam, so we ALWAYS surface the manual-recovery
			// hint too. That keeps a leaked lock both recoverable AND discoverable even if
			// the in-handler release did not complete (maintainer point 3).
			void issueProvider.removeLabel({
				cwd,
				issueNumber,
				label: PROCESSING_LOCK_LABEL,
				env,
			});
			note(manualRecovery);
		},
	};
}

/**
 * The DECIDE (prompt → verdict) + DISPATCH (the four-outcome table) band, run
 * INSIDE the `processing` lock {@link performIntake} acquires/releases around it.
 * Split out so the lock release is a clean `try`/`finally` in the caller (the lock
 * MUST release on every terminal path — success or handled failure). The agent
 * DRAFTS only; the runner owns every git/seam side-effect here.
 */
async function decideAndDispatch(
	options: PerformIntakeOptions,
	cwd: string,
	issue: Issue,
	comments: IssueComment[],
	ctx: {
		arbiter: string;
		issueProvider: IssueProvider;
		note: (message: string) => void;
	},
): Promise<IntakeResult> {
	const {arbiter, issueProvider, note} = ctx;
	const issueNumber = issue.number;
	const env = options.env;

	// DECIDE: prompt → VERDICT. The agent DRAFTS only (no git, no seam ops). Tests
	// inject a canned verdict (the dispatcher's testable seam); production wires the
	// harness. The prompt's judgement is not unit-tested — only the dispatch.
	const prompt = buildIntakeDecisionBrief(issue, comments);
	let verdict: IntakeVerdict;
	try {
		verdict = await runDecision(options, cwd, issue, comments, prompt);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		const message = `Intake decision failed for issue #${issueNumber}: ${detail}`;
		note(message);
		return {exitCode: 1, outcome: 'agent-failed', issueNumber, message};
	}

	// DISPATCH on the verdict — the FULL four-outcome decision table (PRD
	// `issue-intake`). The agent only DRAFTED the verdict; the runner owns every
	// git/seam side-effect below (the in-band boundary): the write + integrate
	// (slice/prd) and the `postIssueComment` (ask/bounce).
	//
	// PER-OUTCOME integration (PRD US #9): the resolved mode is keyed on the runtime
	// artifact TYPE — a `slice` verdict integrates with the SLICE mode, a `prd`
	// verdict with the PRD mode. Unset ⇒ propose for both. ask/bounce never
	// integrate, so the modes are no-ops for them.
	const modes = options.integration ?? {slice: 'propose', prd: 'propose'};
	switch (verdict.outcome) {
		case 'slice':
			return dispatchSlice({
				verdict,
				issueNumber,
				cwd,
				arbiter,
				integration: modes.slice,
				provider: options.provider,
				env,
				note,
			});
		case 'prd':
			return dispatchPrd({
				verdict,
				issueNumber,
				cwd,
				arbiter,
				integration: modes.prd,
				provider: options.provider,
				env,
				note,
			});
		case 'ask':
			return dispatchComment({
				outcome: 'asked',
				cwd,
				issueNumber,
				issueProvider,
				// The drafted clarifying question; a thin fallback keeps the comment
				// non-empty if the agent left it blank.
				body:
					verdict.question && verdict.question.trim() !== ''
						? verdict.question
						: `Could you clarify issue #${issueNumber} so it can be acted on?`,
				env,
				note,
			});
		case 'bounce':
			return dispatchComment({
				outcome: 'bounced',
				cwd,
				issueNumber,
				issueProvider,
				// The drafted bounce message; a thin fallback restates the "file separate
				// issues" ask. The issue is left OPEN (no close — closing is CI's JOB).
				body:
					verdict.bounceMessage && verdict.bounceMessage.trim() !== ''
						? verdict.bounceMessage
						: `This issue looks like multiple unrelated concerns — please file ` +
							`separate issues so each can be intaken on its own.`,
				env,
				note,
			});
	}
}

/**
 * DISPATCH the `ask` / `bounce` outcomes: `postIssueComment` the drafted text and
 * emit NOTHING (no `work/` file, no integrate). The issue is left OPEN in BOTH
 * cases — `ask` waits for the thread to be answered (a later run resumes from it),
 * and `bounce` waits for the asks to be re-filed separately; closing the issue is
 * NEVER `intake`'s (it is CI's close JOB, `runner-in-ci`). The comment poster is
 * advisory and DEGRADES (a missing/unauthenticated `gh` never throws — the text is
 * surfaced), so the run still terminates cleanly.
 */
async function dispatchComment(params: {
	outcome: 'asked' | 'bounced';
	cwd: string;
	issueNumber: number;
	issueProvider: IssueProvider;
	body: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<IntakeResult> {
	const {outcome, cwd, issueNumber, issueProvider, body, env, note} = params;
	const posted = await issueProvider.postIssueComment({
		cwd,
		issueNumber,
		body,
		env,
	});
	const verb =
		outcome === 'asked' ? 'asked a clarifying question on' : 'bounced';
	const tail = posted.posted
		? 'the comment was posted'
		: `the comment could NOT be posted (${posted.instruction})`;
	const message =
		`Intake ${verb} issue #${issueNumber}; emitted no artifact and left the issue ` +
		`open — ${tail}.`;
	note(message);
	return {
		exitCode: 0,
		outcome,
		issueNumber,
		commented: posted.posted,
		message,
	};
}

/**
 * DISPATCH the `slice` outcome: derive a content-derived slug, write
 * `work/backlog/<slug>.md` (`covers: []`, NO `prd:`) carrying `issue: N` (the
 * lone-slice closure link, NOT `Fixes #N`), and integrate via {@link
 * performIntegration}. The runner owns the git: it onboards a
 * `work/<slug>` branch off fresh `<arbiter>/main`, then the lifecycle `stage`
 * writes + stages the slice and the band commits + rebases + integrates it. The
 * agent did NO git/seam ops.
 */
async function dispatchSlice(params: {
	verdict: IntakeVerdict;
	issueNumber: number;
	cwd: string;
	arbiter: string;
	integration: IntegrationMode;
	provider: ReviewProviderName | undefined;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<IntakeResult> {
	const {verdict, issueNumber, cwd, arbiter, integration, provider, env, note} =
		params;

	// A content-derived slug — NEVER a counter (PRD US #8). Prefer the drafted
	// `sliceSlug`, else derive from the drafted title; sanitise either through
	// `paramCase` so the filename + frontmatter slug are well-formed.
	const slug = resolveSlug(verdict);
	if (slug === '') {
		const message =
			`Intake produced a 'slice' verdict for issue #${issueNumber} with no usable ` +
			`slug/title to derive a content-derived slug from (never a counter).`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', issueNumber, message};
	}
	const relPath = `work/backlog/${slug}.md`;

	// ONBOARD the slice write onto a `work/<slug>` branch cut from the freshly-
	// fetched `<arbiter>/main` (the SAME runner-owns-git discipline the slicing path
	// uses): the lifecycle `stage` writes the file ON THIS BRANCH and the shared
	// integrate core (`--propose` PR / `--merge` main) lands it. The agent ran no git.
	await switchToWorkBranch(cwd, arbiter, slug, env);

	const sliceContent = renderBacklogSlice({
		slug,
		title: verdict.sliceTitle ?? slug,
		body: verdict.sliceBody,
		issueNumber,
	});

	const core = await performIntegration({
		cwd,
		arbiter,
		slug,
		// `source`/`recovering` are slice-shaped and IGNORED when `lifecycle` is set.
		source: 'in-progress',
		recovering: false,
		// An intake-emitted slice has no `verify` floor of its own (it is a new
		// backlog item, not a build); skip the acceptance gate, exactly as the
		// slicing transition does.
		skipVerify: true,
		// Default `propose` (the per-outcome KNOBS are a later slice). `autoMerge:
		// true` so the EXPLICITLY-chosen mode proceeds as-is (a future `--merge-slice`
		// still lands on main); the build gate's auto-merge downgrade is not this
		// command's concern.
		autoMerge: true,
		mode: integration,
		provider,
		type: 'feat',
		lifecycle: {
			// The emitted slice IS the title source — read it from the path the stage
			// writes (before nothing moves it; the file persists).
			titlePath: join(cwd, relPath),
			commitTag: 'intake',
			stage: () => stageIntakeSlice({cwd, relPath, content: sliceContent, env}),
		},
		env,
		note,
	});

	return integrationToIntakeResult(core, {issueNumber, slug, relPath});
}

/**
 * DISPATCH the `prd` outcome: derive a content-derived slug, write
 * `work/prd/<slug>.md` carrying `issue: N` (the loop-closure linkage the close JOB
 * reaches via `slice.prd: → PRD issue:`; on a fanned PRD the number lives ONLY on
 * the PRD — a fanned slice uses `prd:`, NOT its own `issue:`, which is the
 * lone-SLICE outcome's link) + the gate axes the prompt JUDGED, integrate it
 * via {@link performIntegration}, then STOP. Slicing the emitted PRD is the SEPARATE
 * `do prd:` step (NOT done here). A coupled-but-SMALL pair lands here too (the PRD
 * vs BOUNCE line is SHARED VISION, not size — the over-bounce guard). The runner
 * owns the git exactly as the slice branch does; the agent did NO git/seam ops.
 */
async function dispatchPrd(params: {
	verdict: IntakeVerdict;
	issueNumber: number;
	cwd: string;
	arbiter: string;
	integration: IntegrationMode;
	provider: ReviewProviderName | undefined;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<IntakeResult> {
	const {verdict, issueNumber, cwd, arbiter, integration, provider, env, note} =
		params;

	// A content-derived slug — NEVER a counter (PRD US #8). Prefer the drafted
	// `prdSlug`, else derive from the drafted title.
	const slug = resolvePrdSlug(verdict);
	if (slug === '') {
		const message =
			`Intake produced a 'prd' verdict for issue #${issueNumber} with no usable ` +
			`slug/title to derive a content-derived slug from (never a counter).`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', issueNumber, message};
	}
	const relPath = `work/prd/${slug}.md`;

	// ONBOARD onto a `work/<slug>` branch off fresh `<arbiter>/main` — the SAME
	// runner-owns-git discipline the slice branch uses.
	await switchToWorkBranch(cwd, arbiter, slug, env);

	const prdContent = renderPrd({
		slug,
		title: verdict.prdTitle ?? slug,
		body: verdict.prdBody,
		issueNumber,
		humanOnly: verdict.prdHumanOnly,
		needsAnswers: verdict.prdNeedsAnswers,
	});

	const core = await performIntegration({
		cwd,
		arbiter,
		slug,
		source: 'in-progress',
		recovering: false,
		// An intake-emitted PRD has no `verify` floor of its own (it is a new spec,
		// not a build), exactly as the slice branch + the slicing transition skip it.
		skipVerify: true,
		autoMerge: true,
		mode: integration,
		provider,
		type: 'feat',
		lifecycle: {
			titlePath: join(cwd, relPath),
			commitTag: 'intake',
			stage: () => stageIntakeSlice({cwd, relPath, content: prdContent, env}),
		},
		env,
		note,
	});

	return integrationToIntakeResult(core, {
		issueNumber,
		slug,
		relPath,
		kind: 'prd',
	});
}

/**
 * Map the shared integrate band's {@link IntegrationCoreResult} onto the intake
 * {@link IntakeResult}. On `completed` the slice was written + integrated; a
 * `rebase-conflict` against an advanced `main` maps to `stale` (the analogue of
 * "the backlog moved under us"); everything else maps defensively to a usage error
 * (the intake slice path passes `skipVerify` + has no review gate, so neither
 * `gate-failed` nor `review-blocked` can occur).
 */
function integrationToIntakeResult(
	core: IntegrationCoreResult,
	ctx: {
		issueNumber: number;
		slug: string;
		relPath: string;
		kind?: 'slice' | 'prd';
	},
): IntakeResult {
	const {issueNumber, slug, relPath} = ctx;
	const kind = ctx.kind ?? 'slice';
	const artifact = kind === 'prd' ? 'PRD' : 'slice';
	if (core.outcome === 'completed') {
		const landed =
			core.integration?.mode === 'merge'
				? 'landed it on the arbiter main'
				: 'opened a PR carrying it (main untouched)';
		// Both a lone slice and a PRD carry `issue: N` as their closure link (the slice
		// closes its own issue; a PRD is reached via `slice.prd: → PRD issue:`). `intake`
		// never closes the issue, and emits no `Fixes #N` (a deferred GitHub-only
		// optimisation).
		const link = `issue: ${issueNumber}`;
		const message =
			`Intake of issue #${issueNumber} → wrote ${relPath} (${link}); ` +
			`the runner integrated it through the shared core and ${landed}.`;
		return {
			exitCode: 0,
			outcome: kind === 'prd' ? 'prd' : 'sliced',
			issueNumber,
			emittedSlug: slug,
			emitted: relPath,
			message,
		};
	}
	if (core.outcome === 'rebase-conflict') {
		return {
			exitCode: 4,
			outcome: 'stale',
			issueNumber,
			message:
				core.reason ??
				`Integrating the intake ${artifact} for issue #${issueNumber} conflicted ` +
					`against the latest main; re-run intake.`,
		};
	}
	return {
		exitCode: 1,
		outcome: 'usage-error',
		issueNumber,
		message:
			core.reason ??
			`Integrating the intake ${artifact} for issue #${issueNumber} failed unexpectedly.`,
	};
}

/**
 * Resolve a content-derived slug from the verdict — NEVER a counter (PRD US #8).
 * Prefer the drafted `sliceSlug`, else derive from the drafted title; both go
 * through `paramCase` (the brand case-transform) so the result is a clean
 * lowercase-`-`-joined slug. An empty result (no slug AND no title) signals the
 * caller to refuse (a counter fallback is forbidden).
 */
function resolveSlug(verdict: IntakeVerdict): string {
	const candidate =
		verdict.sliceSlug && verdict.sliceSlug.trim() !== ''
			? verdict.sliceSlug
			: (verdict.sliceTitle ?? '');
	return paramCase(candidate);
}

/**
 * Resolve a content-derived slug for the PRD outcome — NEVER a counter (PRD US #8).
 * Prefer the drafted `prdSlug`, else derive from the drafted PRD title; both go
 * through `paramCase`. An empty result signals the caller to refuse.
 */
function resolvePrdSlug(verdict: IntakeVerdict): string {
	const candidate =
		verdict.prdSlug && verdict.prdSlug.trim() !== ''
			? verdict.prdSlug
			: (verdict.prdTitle ?? '');
	return paramCase(candidate);
}

/**
 * Render the backlog slice file: the frontmatter (`title`/`slug`/`covers: []`, NO
 * `prd:` — its own source of truth, PRD decision table) carrying the lone-slice
 * `issue: N` closure link + the drafted body. The slice closes its source issue
 * via its `issue:` field (the provider-agnostic link a FUTURE CI close-job reads
 * from folder + field state); it carries NO `Fixes #N` (a deferred GitHub-only
 * optimisation, structurally unplaceable on the `--merge` path). The number is
 * the slice's own closure path — `issue:` XOR `prd:`; a lone slice never carries a
 * `prd:` (PRD decision table). When the agent drafted no body, a thin default
 * scaffold keeps the file a valid slice.
 */
function renderBacklogSlice(params: {
	slug: string;
	title: string;
	body: string | undefined;
	issueNumber: number;
}): string {
	const {slug, title, body, issueNumber} = params;
	const frontmatter = [
		'---',
		`title: ${title}`,
		`slug: ${slug}`,
		`issue: ${issueNumber}`,
		'covers: []',
		'blockedBy: []',
		'---',
	].join('\n');
	const drafted =
		body && body.trim() !== ''
			? body.trim()
			: [
					'## What to build',
					'',
					title,
					'',
					'## Acceptance criteria',
					'',
					'- [ ] the issue is resolved',
					'',
					'## Prompt',
					'',
					`> Resolve issue #${issueNumber}: ${title}`,
				].join('\n');
	return `${frontmatter}\n\n${drafted}\n`;
}

/**
 * Render the emitted PRD file: the frontmatter (`title`/`slug` + the loop-closure
 * `issue: N` + the gate axes the prompt JUDGED) followed by the drafted PRD body.
 * For a FANNED PRD the `issue: N` lives ONLY on the PRD — never duplicated across
 * the N fanned slices, which reach it via `slice.prd: → PRD issue:` (a fanned
 * slice carries `prd:`, NOT its own `issue:`; the lone-SLICE outcome is the only
 * one that puts `issue:` on a slice). The close JOB reaches the PRD's number via
 * `slice.prd: → PRD issue:`. The gate axes (`humanOnly`/`needsAnswers`) are emitted ONLY when the
 * verdict declared them `true` — an omitted axis is `undefined` (undeclared), the
 * same convention `frontmatter.ts` parses. When the agent drafted no body, a thin
 * default scaffold keeps the file a valid PRD that `do prd:` can later slice.
 */
function renderPrd(params: {
	slug: string;
	title: string;
	body: string | undefined;
	issueNumber: number;
	humanOnly: boolean | undefined;
	needsAnswers: boolean | undefined;
}): string {
	const {slug, title, body, issueNumber, humanOnly, needsAnswers} = params;
	const lines = [
		'---',
		`title: ${title}`,
		`slug: ${slug}`,
		`issue: ${issueNumber}`,
	];
	// Surface the gate axes AS THE PROMPT JUDGED THEM (PRD US #8). Only emit a `true`
	// axis — an undeclared axis stays absent (parsed as `undefined`).
	if (humanOnly === true) {
		lines.push('humanOnly: true');
	}
	if (needsAnswers === true) {
		lines.push('needsAnswers: true');
	}
	lines.push('---');
	const frontmatter = lines.join('\n');
	const drafted =
		body && body.trim() !== ''
			? body.trim()
			: [
					'## Problem Statement',
					'',
					`Transformed from issue #${issueNumber}: ${title}`,
					'',
					'## Solution',
					'',
					'(to be detailed; this PRD needs slicing via `do prd:`).',
					'',
					'## User Stories',
					'',
					`1. As a user, I want issue #${issueNumber} addressed.`,
				].join('\n');
	return `${frontmatter}\n\n${drafted}\n`;
}

/**
 * STAGE the intake slice into the index on the `work/<slug>` branch (the
 * {@link performIntegration} lifecycle seam): write the `work/backlog/<slug>.md`
 * file (runner-owned; the agent never writes git-visible files) and `git add` it.
 * The band's subsequent `git add -A` + atomic commit folds it into ONE runner-owned
 * commit.
 */
async function stageIntakeSlice(params: {
	cwd: string;
	relPath: string;
	content: string;
	env: NodeJS.ProcessEnv | undefined;
}): Promise<void> {
	const {cwd, relPath, content, env} = params;
	const abs = join(cwd, relPath);
	mkdirSync(dirname(abs), {recursive: true});
	writeFileSync(abs, content);
	await gitHard(['add', '--', relPath], cwd, env);
}

/**
 * ONBOARD the intake slice write onto a `work/<slug>` branch cut from the freshly-
 * fetched `<arbiter>/main` (the SAME discipline `slicing.ts` uses). A pre-existing
 * local `work/<slug>` (a re-run) is force-recreated off fresh main.
 */
async function switchToWorkBranch(
	cwd: string,
	arbiter: string,
	slug: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	const branch = `work/${slug}`;
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	await gitHard(
		['switch', '--quiet', '-C', branch, `${arbiter}/main`],
		cwd,
		env,
	);
}

/** Run git; throw on non-zero (genuinely unexpected plumbing failures). */
async function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	const result = await runAsync('git', args, cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result;
}

/** Run the decision step. Prefers the injected decider; else the harness seam. */
async function runDecision(
	options: PerformIntakeOptions,
	cwd: string,
	issue: Issue,
	comments: IssueComment[],
	prompt: string,
): Promise<IntakeVerdict> {
	if (options.decide) {
		return options.decide({cwd, issue, comments, prompt, env: options.env});
	}
	// PRODUCTION: launch the harness with the decision brief, then PARSE the verdict
	// the agent emitted out of its ANSWER channel (`launched.output`) — the SAME wire
	// the review gate runs (launch → `parseReviewVerdict(readOutput(launched.output))`;
	// `harnessReviewGate`). The agent emits a single fenced ```json block (the OUTPUT
	// CONTRACT {@link buildIntakeDecisionBrief} appends); {@link parseIntakeVerdict}
	// extracts + validates it. The model's JUDGEMENT is not unit-tested — only the
	// parse + dispatch — exactly as the review prompt's judgement is not.
	const harness = options.harness ?? new NullHarness();
	const launched = await launchWithOptionalWatch({
		harness,
		dir: cwd,
		slug: `intake-${issue.number}`,
		command: options.agentCmd ?? '',
		prompt,
		model: options.model,
		sessionId: `intake-${issue.number}`,
		sessionsDir: options.sessionsDir,
		env: options.env,
	});
	if (!launched.ok) {
		throw new Error(launched.detail ?? 'the intake decision agent failed.');
	}
	// Read the verdict from the agent's ANSWER channel (`output`), NOT `detail` (the
	// failure channel, empty on success) — the SAME `output ?? ''` normalisation the
	// review gate's `readOutput` default applies. A malformed/absent verdict throws,
	// which `decideAndDispatch`'s try/catch already maps onto `agent-failed` (exit 1).
	return parseIntakeVerdict(launched.output ?? '');
}

/**
 * Parse the decision agent's emitted VERDICT out of its (possibly prose-wrapped /
 * fenced) textual output into an {@link IntakeVerdict} — the PRODUCTION wire
 * between the launched agent and the already-built dispatcher, modeled 1:1 on the
 * review gate's `parseReviewVerdict` twin (`review-gate.ts`). It pulls the first
 * JSON object carrying an `"outcome"` field via the SHARED
 * {@link extractJsonObjectSpan} (NOT a forked second "first JSON object in agent
 * prose" extractor — the review gates anchor on `"verdict"`, intake on
 * `"outcome"`; same need, one implementation — coherence), `JSON.parse`s it, and
 * validates the shape: `outcome ∈ {ask,slice,prd,bounce}`.
 *
 * The per-outcome fields map 1:1 onto {@link IntakeVerdict} (`slice` →
 * sliceSlug?/sliceTitle/sliceBody, `prd` →
 * prdSlug?/prdTitle/prdBody/prdHumanOnly?/prdNeedsAnswers?, `ask` → question,
 * `bounce` → bounceMessage). Missing OPTIONALS are tolerated — the dispatcher
 * already has fallbacks (slug-from-title, the thin comment/scaffold defaults).
 *
 * THROWS a clear error on: no JSON object present, invalid JSON, or an `outcome`
 * not in the set. The caller (`decideAndDispatch`) maps any throw onto the
 * `agent-failed` outcome (exit 1) — a malformed verdict degrades honestly, never
 * a crash and never a silent dispatch.
 */
export function parseIntakeVerdict(output: string): IntakeVerdict {
	const span = extractJsonObjectSpan(output, 'outcome');
	if (span === undefined) {
		throw new Error(
			'intake decision agent produced no parseable {outcome, …} verdict.',
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(output.slice(span.start, span.end));
	} catch (err) {
		throw new Error(
			`intake verdict was not valid JSON: ${(err as Error).message}`,
		);
	}
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('intake verdict was not an object.');
	}
	const obj = parsed as Record<string, unknown>;
	const outcome = obj.outcome;
	if (
		outcome !== 'ask' &&
		outcome !== 'slice' &&
		outcome !== 'prd' &&
		outcome !== 'bounce'
	) {
		throw new Error(
			`intake verdict 'outcome' was not one of ask|slice|prd|bounce (got ` +
				`${JSON.stringify(outcome)}).`,
		);
	}
	// Map the per-outcome fields onto the verdict shape, keeping ONLY the strings/
	// booleans the dispatcher consumes (a missing optional stays absent — the
	// dispatcher's fallbacks cover it). Every field is optional on the type, so the
	// `slice`/`prd` content + the `ask`/`bounce` text are carried verbatim when present.
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' ? v : undefined;
	const bool = (v: unknown): boolean | undefined =>
		typeof v === 'boolean' ? v : undefined;
	return {
		outcome,
		...(str(obj.sliceSlug) !== undefined
			? {sliceSlug: str(obj.sliceSlug)}
			: {}),
		...(str(obj.sliceTitle) !== undefined
			? {sliceTitle: str(obj.sliceTitle)}
			: {}),
		...(str(obj.sliceBody) !== undefined
			? {sliceBody: str(obj.sliceBody)}
			: {}),
		...(str(obj.question) !== undefined ? {question: str(obj.question)} : {}),
		...(str(obj.prdSlug) !== undefined ? {prdSlug: str(obj.prdSlug)} : {}),
		...(str(obj.prdTitle) !== undefined ? {prdTitle: str(obj.prdTitle)} : {}),
		...(str(obj.prdBody) !== undefined ? {prdBody: str(obj.prdBody)} : {}),
		...(bool(obj.prdHumanOnly) !== undefined
			? {prdHumanOnly: bool(obj.prdHumanOnly)}
			: {}),
		...(bool(obj.prdNeedsAnswers) !== undefined
			? {prdNeedsAnswers: bool(obj.prdNeedsAnswers)}
			: {}),
		...(str(obj.bounceMessage) !== undefined
			? {bounceMessage: str(obj.bounceMessage)}
			: {}),
	};
}

/**
 * Build the intake decision BRIEF (an inline prompt builder, like `buildSlicingBrief`
 * in `slicing.ts` / the reviewer prompts in `review-gate.ts` — NOT a standalone
 * asset/`.md` file; no such convention exists in this package). It encodes the FULL
 * four-outcome decision table (PRD `issue-intake` — the source of truth) and the
 * three DECISION AIDS stated once there:
 *
 * 1. the **"clear?" bar** = `to-slices`/`needsAnswers`' "would I build the wrong
 *    thing if I guessed?" — if a material requirement/scope/acceptance question is
 *    unanswered, ASK (never guess a spec from a vague issue);
 * 2. the **"one slice?" bar** = `to-slices`' tracer-bullet test (one thin end-to-end
 *    path, demoable on its own) — fits → SLICE, needs splitting → PRD;
 * 3. **PRD vs BOUNCE** turns on a **SHARED VISION**: coupled (even if small) → PRD;
 *    genuinely unrelated → BOUNCE. Size NEVER forces a bounce — only unrelatedness
 *    (the over-bounce guard: a coupled-but-small pair gets a light PRD, never a
 *    bounce).
 *
 * The prompt anchors to `to-slices`/`to-prd` for the slice/PRD SHAPES it drafts. Its
 * JUDGEMENT is NOT unit-tested (exactly as the review prompt's is not) — only the
 * dispatch is. The agent only DRAFTS the verdict + its content; it does NO git/seam
 * ops (the runner owns every postComment / write / integrate — the in-band boundary).
 */
export function buildIntakeDecisionBrief(
	issue: Issue,
	comments: IssueComment[],
): string {
	const thread =
		comments.length === 0
			? '(no comments yet)'
			: comments
					.map(
						(c, i) =>
							`#${i + 1} ${c.author ? `@${c.author}` : '(unknown)'}: ${c.body}`,
					)
					.join('\n\n');
	return [
		`You are the agent-runner INTAKE agent. Decide what to do with GitHub issue`,
		`#${issue.number}: "${issue.title}". You read the issue + its full comment`,
		`thread and return ONE verdict (the runner DISPATCHES on it deterministically).`,
		'',
		'Issue body:',
		issue.body.trim() === '' ? '(empty)' : issue.body,
		'',
		'Comment thread (oldest first):',
		thread,
		'',
		'## The decision — classify the issue into exactly ONE of four verdicts',
		'',
		'- **ASK** — the issue is NOT clear enough to act on: a material requirement,',
		'  scope, or acceptance question is unanswered. Use the same bar `to-slices`',
		'  uses for `needsAnswers`: "would I build the WRONG thing if I guessed now?"',
		'  If yes → ASK. Draft the SINGLE next clarifying question (do NOT guess a spec',
		'  from a vague issue). The runner posts it and stops; a later run resumes from',
		'  the updated thread.',
		'',
		'- **SLICE** — the issue is CLEAR *and* it fits ONE tracer-bullet vertical slice',
		'  (a single thin end-to-end path, demoable on its own — `to-slices`’ criterion).',
		'  Draft that ONE slice in the `to-slices` shape (a `## What to build`,',
		'  `## Acceptance criteria`, and `## Prompt`). The runner writes',
		'  `work/backlog/<slug>.md` (`covers: []`, NO `prd:`) carrying `issue: N` (the',
		'  lone-slice closure link, NOT `Fixes #N`) and integrates it.',
		'',
		'- **PRD** — the issue is CLEAR *and* coherent but needs MORE THAN ONE slice (it',
		'  cannot be one tracer-bullet path — it splits for scope/architecture). >1 slice',
		'  ⟺ a shared vision worth recording ⟺ a PRD. Draft a PRD in the `to-prd` shape',
		'  (`## Problem Statement`, `## Solution`, `## User Stories`, `## Out of Scope`).',
		'  The runner writes `work/prd/<slug>.md` with `issue: N` and integrates it;',
		'  SLICING the PRD is a SEPARATE later step (`do prd:`) — do not slice it here.',
		'  **INCLUDES a coupled-but-SMALL pair: if two asks share a vision they get a',
		'  (light) PRD — they are NEVER bounced.**',
		'',
		'- **BOUNCE** — the issue is really MULTIPLE UNRELATED concerns wearing one issue:',
		'  you cannot articulate a SINGLE shared vision tying them together. Draft a short',
		'  message asking the author to file separate issues. The runner posts it and',
		'  leaves the issue OPEN (it never closes the issue).',
		'',
		'## The three decision aids (apply them in order)',
		'',
		'1. **"clear?"** (ASK vs the rest): the `needsAnswers` bar — would acting now risk',
		'   building the wrong thing? If yes → ASK. Otherwise it is clear; continue.',
		'2. **"one slice?"** (SLICE vs PRD): the `to-slices` tracer-bullet test — one thin',
		'   end-to-end path, demoable alone? Fits → SLICE; needs splitting → PRD.',
		'3. **"shared vision?"** (PRD vs BOUNCE): coupled (even if small) → PRD; genuinely',
		'   unrelated → BOUNCE. SIZE NEVER forces a bounce — only UNRELATEDNESS does. Do',
		'   not over-bounce a small coupled pair: it is a light PRD.',
		'',
		'## Boundary',
		'',
		'You only DRAFT the verdict + its content (the slice/PRD body, or the comment',
		'text). You do NOT perform ANY git operation and you do NOT post any comment — the',
		'runner owns every git/seam side-effect (write, integrate, postComment). For a PRD',
		'verdict, also judge its gate axes (humanOnly / needsAnswers) so the runner can',
		'surface them on the emitted PRD.',
		'',
		'## Output — hand the verdict back as ONE fenced JSON block',
		'',
		'Emit your verdict as a SINGLE fenced ```json block (and nothing else that looks',
		'like JSON). Its keys map 1:1 onto the verdict the runner dispatches on — always an',
		'`"outcome"` plus ONLY the fields for that outcome:',
		'',
		'```json',
		'{"outcome": "slice", "sliceSlug": "<content-derived-slug>", "sliceTitle": "<title>", "sliceBody": "<the markdown AFTER the frontmatter>"}',
		'```',
		'',
		'- **slice** → `sliceTitle` + `sliceBody` (the `## What to build` / `## Acceptance',
		'  criteria` / `## Prompt` markdown — NOT the frontmatter; the runner writes the',
		'  frontmatter + the `issue: N` link) and an optional `sliceSlug` (the runner',
		'  derives one from the title if you omit it — never a counter).',
		'- **prd** → `prdTitle` + `prdBody` (the `## Problem Statement` / `## Solution` / …',
		'  markdown AFTER the frontmatter; the runner writes the frontmatter + `issue: N`),',
		'  an optional `prdSlug`, and the gate axes `prdHumanOnly` / `prdNeedsAnswers`',
		'  (booleans — set `true` when a human should drive the SLICING and/or open',
		'  questions remain; omit otherwise).',
		'- **ask** → `question` (the single next clarifying question).',
		'- **bounce** → `bounceMessage` (the “file separate issues” message).',
		'',
		'`outcome` MUST be exactly one of `ask` | `slice` | `prd` | `bounce`. Strings are',
		'plain text inside the JSON (escape newlines as \\n). Do not wrap the JSON in any',
		'other structure — the runner pulls the first `{"outcome": …}` object out and',
		'dispatches on it.',
	].join('\n');
}
