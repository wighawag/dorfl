/**
 * The `install-ci` ISSUE-INTAKE capability (spec `runner-in-ci`, task
 * `install-ci-intake-trigger-and-review-surface`; capability D: consider incoming
 * issues → task/spec, AND insertion point E: surface the review verdict back into
 * the issue thread). This module GENERATES the one fixed intake workflow file and
 * STRUCTURALLY VALIDATES it, mirroring the snapshot-assertion style of
 * `advance-lifecycle-template.ts` / `advance-ci-template.ts` (the package depends on
 * NO YAML lib, so the checks are presence/shape assertions over the raw text). It
 * ALSO carries the PURE intake-flags DERIVATION ({@link deriveIntakeFlags}) —
 * CI's merge-vs-propose POLICY. Since the CI split (task
 * `ci-split-generate-workflows`) the workflow no longer derives it in a shell
 * step: the called `dorfl-item.yml` lock job derives the same rule from trusted
 * inputs (`ci-phase-intake.ts`: the event's author association, `dorfl.json`
 * at the base). The DOCUMENT mode is the resolved `intakeIntegration`
 * (operator/config); author-trust drives ONLY the origin-trust stamp +
 * placement, never the mode.
 *
 * SCOPE FENCE (spec Out-of-Scope): the issue→artifact TRANSFORM engine is
 * `issue-intake`'s (`intake <N>` + its four-outcome dispatch + the per-outcome
 * KNOBS + the lone-task review that posts to the issue thread). CI only
 * WIRES/SCHEDULES/INVOKES it and owns the merge-vs-propose POLICY + the delivery
 * surface. This module emits NO transform; it emits the WORKFLOW that calls it.
 *
 * The discipline (spec capability-D row + the merge-vs-propose POLICY + the two
 * RESOLVED design decisions in the task):
 *
 *   - TRIGGERS: `issues` opened, `issue_comment` created, and a label
 *     (`dorfl:intake`). Its one job calls `dorfl-item.yml` with
 *     `item: issue:<N>` (lock, agent, apply; decision 10 of ADR
 *     `ci-agent-job-holds-no-write-token`), which runs `intake <N>` (EXPLICIT,
 *     four-outcome dispatch) — never a bare slug.
 *   - EVENT→`IntakeEventKind` MAPPING (Decision 2: no edit-detection): only a
 *     CREATED `issue_comment` (and an opened issue / the label) drives
 *     (re-)evaluation; an EDITED comment is NOT a trigger (the ID-based
 *     `seen=<ids>` watermark suffices). The "post a NEW comment to signal an edit"
 *     convention is documented in the workflow so a human knows to re-trigger.
 *   - INTAKE-INTEGRATION → the file-emit MODE; AUTHOR-TRUST → PLACEMENT + the
 *     STAMP (ADR `untrusted-origin-carries-via-stamp-not-forced-staging`; spec
 *     `intake-integration-knob-and-specs-land-in-proposed-rename`; {@link
 *     deriveIntakeFlags}): the intake DOCUMENT mode (merge-vs-propose for a
 *     task/spec FILE) is the resolved `intakeIntegration ?? integration` — an
 *     operator/config choice, a SINGLE value applied to BOTH the task and the spec
 *     document, DECOUPLED from the autonomy gates. `autoBuild`/`autoTask` no
 *     longer feed the document mode (they mean ONLY "may an agent act
 *     autonomously"). Author-trust feeds exactly (1) the `--origin-trust` STAMP
 *     (`author_association` not in OWNER/MEMBER/COLLABORATOR ⇒ `untrusted`) and
 *     (2) — via that stamp, read by `intake`'s dispatch — which PLACEMENT default
 *     (`untrusted*LandIn` vs `*LandIn`) the emitted document lands in. Untrusted
 *     safety is the CARRIED stamp (it forces the BUILD transition to a code PR)
 *     plus the placement default, NOT a forced document PR. A document therefore
 *     merges to `main` regardless of who filed the issue OR whether the gates are
 *     on; whether it is reviewed-as-a-PR is purely the `intakeIntegration`
 *     operator config, not a trust or autonomy consequence.
 *   - INSERTION POINT E (the issue-thread review surface): the review verdict over
 *     intake's generated specs/tasks is surfaced into the ISSUE THREAD via the
 *     `IssueProvider.postIssueComment` seam (issue thread, by NUMBER — NOT the PR
 *     seam `postPRComment`, which is keyed by url). This is REUSED, not new:
 *     `intake <N>` already runs the lone-task review/edit loop and posts its
 *     findings as questions through `postIssueComment`. The workflow surfaces E by
 *     INVOKING `intake`; it adds no second review mechanism.
 *   - CI runs IN-PLACE (the CI container IS the isolation): no
 *     `--isolated`/`--remote`/registry. A PER-ISSUE concurrency group serialises
 *     overlapping ticks on the SAME issue; the `processing` lock / claim CAS is the
 *     real cross-run serialiser.
 *   - The running CI job NEVER edits `.github/workflows/**` (US #9): it requests NO
 *     `workflows` permission and cannot rewrite its own triggers. It grants
 *     `contents: write` + `pull-requests: write` (emit/propose the artifact) +
 *     `issues: write` (post the clarifying/review comment back) + `actions` and
 *     `checks: read` (the apply job tells a timed-out agent job from a
 *     cancelled one), which the called workflow's jobs narrow per job.
 *
 * The structural validator is the dependency-free counterpart of "the workflow
 * parses + carries the right discipline" the task's acceptance criteria require;
 * the test generates this artifact under `--fake` and asserts every invariant.
 */

import {brand} from './brand.js';
import type {ResolvedCIConfig} from './install-ci-core.js';
import {
	ITEM_WORKFLOW_CALLER_PERMISSIONS,
	itemCallSecrets,
} from './dorfl-item-template.js';

/** The capability id (the registry key + the emitted workflow file stem). */
export const INTAKE_TRIGGER_CAPABILITY_ID = 'intake';

/** The wizard-facing label for the issue-intake capability. */
export const INTAKE_TRIGGER_CAPABILITY_LABEL =
	'Consider incoming issues → task/spec + surface the review verdict into the issue thread (the intake trigger: issues / issue_comment / label)';

/** The repo-relative path (under the output base) of the emitted workflow. */
export const INTAKE_TRIGGER_WORKFLOW_PATH = 'workflows/intake.yml';

/**
 * The intake-trigger LABEL: a label whose addition (re-)triggers intake on an
 * issue (the "label" trigger of capability D), brand-namespaced exactly like the
 * `processing` lock so it cannot collide with a user's own labels. DISTINCT from
 * the transient `processing` lock — this one is a human-facing "please (re-)intake
 * this" signal, not a concurrency mutex.
 */
export const INTAKE_TRIGGER_LABEL = `${brand.base}:intake`;

// ─── The AUTHOR-TRUST → per-outcome-flags DERIVATION (CI's POLICY) ────────────

/**
 * The trusted `author_association` values (Decision 1): a repo OWNER, an org
 * MEMBER, or a write-COLLABORATOR is TRUSTED; everyone else
 * (`CONTRIBUTOR`/`FIRST_TIME_CONTRIBUTOR`/`FIRST_TIMER`/`NONE`/anything unknown)
 * is UNTRUSTED. This is the WHOLE author-trust signal — admin/write-collaborator,
 * read straight off the event payload, no extra API call, no multi-factor matrix.
 */
export const TRUSTED_AUTHOR_ASSOCIATIONS = [
	'OWNER',
	'MEMBER',
	'COLLABORATOR',
] as const;

/**
 * The per-outcome integration flags CI passes to `intake <N>` — the GRANULAR
 * per-type pair (the aggregates `--merge`/`--propose` are not needed because CI
 * always resolves BOTH types explicitly). Each is `'merge'` or `'propose'`.
 *
 * Both {@link spec} and {@link task} are the SAME resolved `intakeIntegration`
 * value (spec `intake-integration-knob-and-specs-land-in-proposed-rename` US #1
 * chose a SINGLE intake-document knob, NOT a per-type split): the pair is kept
 * only because `intake`'s CLI consumes `--merge-task`/`--merge-spec` on two flag
 * axes, not because task and spec can differ. Both are DECOUPLED from the autonomy
 * gates and trust-INDEPENDENT (ADR
 * `untrusted-origin-carries-via-stamp-not-forced-staging`): `autoBuild`/`autoTask`
 * no longer compose into the document mode, and author-trust never did. The trust
 * signal rides only {@link originTrust} (the stamp), which `intake`'s dispatch
 * reads to select the untrusted-side PLACEMENT default. So `spec`/`task` here
 * answer "does the DOCUMENT merge or open a PR", derived purely from the resolved
 * `intakeIntegration` operator config — never from who filed the issue nor whether
 * an agent may act autonomously.
 */
export interface IntakeIntegrationFlags {
	/**
	 * The spec outcome's mode → `--merge-spec` / `--propose-spec`. The resolved
	 * `intakeIntegration ?? integration` (operator/config), IDENTICAL to
	 * {@link task} — the single intake-document knob applied to the spec axis.
	 */
	spec: 'merge' | 'propose';
	/**
	 * The task outcome's mode → `--merge-task` / `--propose-task`. The resolved
	 * `intakeIntegration ?? integration` (operator/config), IDENTICAL to
	 * {@link spec} — the single intake-document knob applied to the task axis.
	 * Neither the autonomy gates nor author-trust force this: an untrusted author's
	 * task DOCUMENT merges to `main` exactly like a trusted one when
	 * `intakeIntegration` is `merge` (the untrusted safety is the carried
	 * {@link originTrust} stamp — which forces the BUILD to a code PR — plus the
	 * placement default, NOT a forced document PR).
	 */
	task: 'merge' | 'propose';
	/**
	 * The ORIGIN-TRUST verdict CI passes to `intake <N>` via `--origin-trust`
	 * (task `untrusted-origin-forces-build-propose`) so the emitted spec/task is
	 * STAMPED with how it was born. This is now the SOLE thing author-trust drives
	 * on the wire: `intake`'s dispatch reads this stamp to (1) select the
	 * untrusted-side PLACEMENT default (`untrusted*LandIn`) and (2) force the later
	 * BUILD transition of an untrusted task to a code PR. Derived from the SAME
	 * `author_association` case the (gate-derived) modes above see, so it cannot
	 * desync. `intake.ts` writes it verbatim onto the frontmatter — it never
	 * re-resolves trust (the `intake.ts` ~L296 boundary: author-trust is CI's
	 * POLICY, passed IN, not resolved here).
	 */
	originTrust: 'trusted' | 'untrusted';
}

/**
 * DERIVE the per-outcome file-emit modes + the origin-trust stamp — CI's intake
 * POLICY (ADR `untrusted-origin-carries-via-stamp-not-forced-staging`; spec
 * `intake-integration-knob-and-specs-land-in-proposed-rename` US #1/#2). This is
 * the load-bearing pure rule the intake lock job applies at runtime (it reads
 * the resolved `intakeIntegration ?? integration` from `dorfl.json` at the base
 * for the MODE, and `author_association` off the event payload for the STAMP;
 * `ci-phase-intake.ts`):
 *
 *   - **DOCUMENT mode (spec = task)** — the resolved `intakeIntegration` value, a
 *     SINGLE mode applied to BOTH the spec and task document: `merge` ⇒
 *     `--merge-spec` + `--merge-task`, `propose` ⇒ `--propose-spec` +
 *     `--propose-task`. DECOUPLED from the autonomy gates: `autoBuild`/`autoTask`
 *     no longer bite the document mode (they mean ONLY "may an agent act
 *     autonomously"). So a repo with `autoBuild: true`/`autoTask: true` +
 *     `intakeIntegration` (or `integration`) `merge` MERGES intake documents to
 *     `main` — previously impossible (the gates forced a document PR).
 *   - **ORIGIN-TRUST stamp** — the ONLY thing author-trust drives: `untrusted`
 *     iff the author is not trusted, else `trusted`. `intake`'s dispatch reads
 *     this stamp to select the untrusted-side PLACEMENT default and to force the
 *     later BUILD transition of an untrusted task to a code PR.
 *
 * So author-trust changes ONLY (a) which folder the document lands in (via the
 * stamp → `untrusted*LandIn`) and (b) the carried stamp — NEVER whether the
 * DOCUMENT is a PR. Whether a document merges or is proposed is now purely the
 * `intakeIntegration` operator config, independent of the gates AND of who filed
 * the issue. The untrusted safety is the stamp (the build-time code PR) plus the
 * placement default, not a forced document PR (the ADR's core move).
 */
export function deriveIntakeFlags(options: {
	intakeIntegration: 'merge' | 'propose';
	authorTrusted: boolean;
}): IntakeIntegrationFlags {
	const {intakeIntegration, authorTrusted} = options;
	// DOCUMENT mode: the resolved `intakeIntegration ?? integration` (operator/config),
	// a SINGLE value applied to BOTH the spec and the task document. Decoupled from
	// the autonomy gates (ADR untrusted-origin-carries-via-stamp-not-forced-staging;
	// spec intake-integration-knob-and-specs-land-in-proposed-rename): autoBuild/
	// autoTask no longer bite the mode, and author-trust never did. The two axes are
	// kept only because intake's CLI takes --merge-spec/--merge-task separately.
	const spec: 'merge' | 'propose' = intakeIntegration;
	const task: 'merge' | 'propose' = intakeIntegration;
	// ORIGIN-TRUST stamp — the SOLE thing author-trust drives on the wire (task
	// `untrusted-origin-forces-build-propose`): the author-trust verdict collapsed
	// to the value `intake` stamps onto the emitted artifact. `intake`'s dispatch
	// reads it to (1) select the untrusted-side placement default (`untrusted*LandIn`)
	// and (2) force the later BUILD transition of an untrusted task to a code PR. It
	// is NOT a re-resolution of trust (CI already resolved it); it is the verdict
	// being CARRIED so it survives the spec/task merge boundary (the becomes-code
	// checkpoint is not laundered when the file lands on main).
	const originTrust: 'trusted' | 'untrusted' = authorTrusted
		? 'trusted'
		: 'untrusted';
	return {spec, task, originTrust};
}

/**
 * Classify an `author_association` string into trusted/untrusted (Decision 1). A
 * missing/empty/unknown value is UNTRUSTED (fail-safe: a public front-door defaults
 * to the conservative, human-in-the-loop path). Case-insensitive on the wire value
 * for robustness, though GitHub emits upper-case.
 */
export function isAuthorTrusted(
	authorAssociation: string | undefined,
): boolean {
	if (!authorAssociation) {
		return false;
	}
	const upper = authorAssociation.toUpperCase();
	return (TRUSTED_AUTHOR_ASSOCIATIONS as readonly string[]).includes(upper);
}

// ─── The workflow generator ──────────────────────────────────────────────────

/**
 * Generate the intake-trigger workflow YAML. Deterministic: the same config
 * produces byte-identical output.
 *
 * THE SPLIT (spec `ci-agent-job-without-write-token`, decision 10 of ADR
 * `ci-agent-job-holds-no-write-token`; task `ci-split-generate-workflows`): the
 * one job CALLS the per-item workflow `dorfl-item.yml` with
 * `item: issue:<N>`, under this workflow's per-issue concurrency group. Its lock
 * job (write token, no agent) takes the `processing` label and DERIVES the
 * intake policy itself: the origin-trust stamp from this run's event
 * (`comment.author_association`, else `issue.author_association`; a called
 * workflow sees its caller's event) and the document mode from
 * `intakeIntegration ?? integration` in `dorfl.json` at the base, the same rule
 * {@link deriveIntakeFlags} states. The decision agent runs in the agent job
 * (read-only token), and the apply job (write token, no agent) posts the
 * comment or integrates the document.
 */
export function generateIntakeWorkflow(config: ResolvedCIConfig): string {
	return `\
# dorfl — the ISSUE INTAKE trigger in CI (capability D: consider incoming
# issues → task/spec, PLUS insertion point E: surface the review verdict into the
# issue thread, spec runner-in-ci). EMITTED by \`dorfl install-ci\`; the human
# commits it. DO NOT hand-edit a copy — re-run install-ci to upgrade the shell.
#
# WHAT IT DOES — \`dorfl intake <N>\` reads issue #N + its comment thread,
# runs a prompt→verdict decision (ask / task / SPEC / bounce), and dispatches it.
# CI owns ONLY the trigger + the merge-vs-propose POLICY + the delivery surface;
# the TRANSFORM is the engine's (the Out-of-Scope fence — CI re-implements none of
# it). The lone-task review/edit loop \`intake\` already runs ALSO surfaces its
# findings as questions back into THIS issue thread via the issue-comment seam (insertion
# point E) — REUSED, not a new review mechanism.
#
# THE SPLIT (ADR ci-agent-job-holds-no-write-token): ANY GitHub user can write
# the issue text the decision agent reads, so the agent never shares a job with
# a write token. The one job below calls dorfl-item.yml with
# \`item: issue:<N>\`: a LOCK job (write token, no agent: takes the \`processing\`
# label), an AGENT job (read-only token, no persisted credential: runs the
# decision) and an APPLY job (write token, no agent: validates the agent's
# handoff as hostile, then comments or integrates the document).
#
# TRIGGERS (capability D): an OPENED issue, a CREATED issue comment, and the
# \`${INTAKE_TRIGGER_LABEL}\` label. A CREATED comment is the (re-)evaluation
# trigger; an EDITED comment is deliberately NOT a trigger (the ID-based
# \`seen=<ids>\` watermark catches new comments; editing a prior comment never
# re-triggers). CONVENTION: if you edit a previous comment to answer intake's
# question, ALSO post a NEW comment noting the edit — the new comment is what drives
# re-evaluation (a fresh id the watermark catches). There is NO edit-detection /
# \`updated_at\` / body-hash tracking.
#
# THE DOCUMENT MODE is \`intakeIntegration\`; AUTHOR-TRUST → PLACEMENT + the STAMP.
# Both are derived by the item's LOCK job from trusted inputs, never from the
# agent: the document merge-vs-propose mode is the resolved
# \`intakeIntegration ?? integration\` in dorfl.json at the base (an
# operator/config choice, a SINGLE value applied to BOTH the task and spec
# document, DECOUPLED from the autonomy gates; spec
# intake-integration-knob-and-specs-land-in-proposed-rename), and the
# origin-trust stamp comes from THIS run's event: an author outside
# OWNER/MEMBER/COLLABORATOR (\`comment.author_association\`, else
# \`issue.author_association\`) is untrusted (ADR
# untrusted-origin-carries-via-stamp-not-forced-staging). Author-trust drives
# only (1) the \`originTrust\` STAMP on the emitted document and (2), via that
# stamp, which PLACEMENT default the document lands in; the untrusted safety is
# the CARRIED stamp (it forces the later BUILD to a code PR) plus the placement
# default, not a forced document PR.
#
# CI runs IN-PLACE (the CI container IS the isolation): NO --isolated/--remote/
# registry (laptop-only affordances). The PER-ISSUE concurrency group below
# serialises overlapping ticks on the SAME issue; the \`processing\` lock / claim
# CAS is the real cross-run serialiser.
#
# SAFETY (US #9): no job requests a \`workflows\` permission, so none can
# rewrite its own triggers.

name: intake

on:
  issues:
    # An OPENED issue triggers a first intake pass. NOT \`edited\` — a body edit's
    # re-evaluation is the engine's event-model concern (issue-intake); the CI
    # trigger relies on a CREATED comment to drive (re-)evaluation.
    types:
      - opened
      - labeled
  issue_comment:
    # A CREATED comment is the (re-)evaluation trigger (Decision 2). An EDITED
    # comment is NOT listed — editing a prior comment never re-triggers; post a NEW
    # comment to signal an edit (the ID-based seen=<ids> watermark catches it).
    types:
      - created

# PER-ISSUE concurrency group: serialise overlapping ticks on the SAME issue (two
# triggers landing close together must not run intake on one issue twice at once).
# The \`processing\` lock / claim CAS is the real cross-run serialiser; this just
# avoids redundant concurrent ticks. Keyed by the issue number so DIFFERENT issues
# still run in parallel. One intake run carries exactly one issue, so no
# parallelism slot applies here.
concurrency:
  group: intake-\${{ github.event.issue.number }}
  cancel-in-progress: false

# Nothing at workflow level: the calling job grants what dorfl-item.yml needs.
permissions: {}

jobs:
  intake:
    # Only run for an issue/comment that actually carries an issue number (a
    # comment on a PR also fires \`issue_comment\`; skip those — there is no issue to
    # intake). \`pull_request\` is absent on a real issue comment.
    if: \${{ github.event.issue.number && !github.event.issue.pull_request }}
    # The union of what dorfl-item.yml's jobs request (a called workflow can
    # only narrow this): the lock and apply jobs write (the \`processing\` label,
    # the comment back into the thread = insertion point E, the document PR or
    # merge); apply reads the agent job's check runs (a timeout vs a cancel).
    permissions:
${ITEM_WORKFLOW_CALLER_PERMISSIONS}
    uses: ./.github/workflows/dorfl-item.yml
    with:
      item: issue:\${{ github.event.issue.number }}${itemCallSecrets(config, false)}
`;
}

/** A single structural problem found in the generated workflow. */
export interface IntakeTriggerProblem {
	/** A short, stable id for the violated invariant (for tests/assertions). */
	id: string;
	/** Human-readable description of what is missing or wrong. */
	message: string;
}

/** The result of {@link validateIntakeWorkflow}. */
export interface IntakeTriggerValidation {
	/** True iff the workflow satisfies EVERY structural invariant. */
	ok: boolean;
	/** Each violated invariant (empty when `ok`). */
	problems: IntakeTriggerProblem[];
}

/**
 * Structurally validate the intake-trigger workflow against the task's acceptance
 * criteria. Dependency-free (no YAML lib): presence/shape assertions over the raw
 * text, mirroring {@link validateAdvanceLifecycleWorkflow} /
 * {@link validateCloseJobWorkflow}.
 */
export function validateIntakeWorkflow(text: string): IntakeTriggerValidation {
	const problems: IntakeTriggerProblem[] = [];
	const require = (id: string, present: boolean, message: string): void => {
		if (!present) {
			problems.push({id, message});
		}
	};

	// The OPERATIVE (non-comment) lines: the prohibitions below (no `--isolated`/
	// `--remote`/`do`/`pull_request` trigger/`.github/workflows` self-edit/edit
	// trigger) are about what the job DOES, not what the explanatory comments
	// MENTION. Strip full-line `#` comments before the negative checks; the positive
	// presence checks run over the full text (comments are harmless there).
	const operative = text
		.split('\n')
		.filter((line) => !/^\s*#/.test(line))
		.join('\n');

	// --- CALLS the per-item workflow with `item: issue:<N>` (decision 10) -------
	require('calls-item-workflow', /\n {4}uses: \.\/\.github\/workflows\/dorfl-item\.yml\n/.test(
		operative,
	), 'the intake job must call the per-item workflow ' +
		'(`uses: ./.github/workflows/dorfl-item.yml`: lock, agent, apply).');
	// The issue number rides the explicit `issue:<N>` item id from the event
	// payload (the issue under intake) — never a bare slug.
	require('intake-explicit-issue-number', /\n {6}item: issue:\$\{\{ github\.event\.issue\.number \}\}\n/.test(
		operative,
	), 'the item must be the explicit `issue:<N>` id ' +
		'(`item: issue:${{ github.event.issue.number }}`).');
	// No agent verb runs in THIS workflow: the decision agent runs in the called
	// workflow's agent job (read-only token).
	require('no-agent-verbs', !/dorfl (?:do|advance|intake|run)\b/.test(
		operative,
	), 'the intake workflow must run no dorfl verb itself: `intake` runs in the ' +
		"called workflow's lock, agent and apply jobs.");
	// The caller grants the union of what the called jobs request.
	require('caller-grants-item-scopes', /\n {4}permissions:\n {6}contents: write\n {6}issues: write\n {6}pull-requests: write\n {6}actions: read\n {6}checks: read\n/.test(
		operative,
	), 'the calling job must grant every scope a job of dorfl-item.yml requests ' +
		'(`contents`, `issues`, `pull-requests: write`; `actions`, `checks: read`).');
	require('workflow-permissions-empty', /^permissions: \{\}$/m.test(
		text,
	), 'the workflow must grant nothing at workflow level (`permissions: {}`).');
	require('secrets-explicit', !/secrets:\s*inherit\b/.test(
		operative,
	), 'secrets reach the called workflow explicitly, never `secrets: inherit`.');
	require('no-pr-identity-token', !/DORFL_GH_TOKEN/.test(
		operative,
	), 'intake keeps the built-in token for its writes (no DORFL_GH_TOKEN is ' +
		'passed to the called workflow).');

	// --- TRIGGERS: issues opened + issue_comment created + the label ------------
	require('trigger-issues-opened', /\bissues:\s*[\s\S]*?types:\s*[\s\S]*?-\s*opened\b/.test(
		text,
	), 'must trigger on an OPENED issue (`on.issues.types: [opened]`).');
	require('trigger-issue-comment-created', /\bissue_comment:\s*[\s\S]*?types:\s*[\s\S]*?-\s*created\b/.test(
		text,
	), 'must trigger on a CREATED issue comment ' +
		'(`on.issue_comment.types: [created]`) — the (re-)evaluation trigger.');
	require('trigger-label', /\bissues:\s*[\s\S]*?types:\s*[\s\S]*?-\s*labeled\b/.test(
		text,
	), 'must trigger on a label (`on.issues.types: [labeled]`).');
	// A comment on a PR also fires `issue_comment`: there is no issue to intake.
	require('skips-pull-request-comments', /if: \$\{\{ github\.event\.issue\.number && !github\.event\.issue\.pull_request \}\}/.test(
		operative,
	), 'the intake job must skip a comment on a pull request (no issue to intake).');

	// --- Decision 2: a CREATED comment triggers; an EDITED comment does NOT ------
	require('no-comment-edited-trigger', !/issue_comment:\s*[\s\S]*?types:\s*[\s\S]*?-\s*edited\b/.test(
		text,
	), 'the `issue_comment` trigger must NOT include `edited` (Decision 2: no ' +
		'edit-detection; a CREATED comment is the (re-)evaluation trigger).');
	require('no-edit-tracking', !/updated_at|body-hash|bodyHash/.test(
		operative,
	), 'must NOT implement `updated_at` / body-hash edit-tracking (Decision 2).');
	require('documents-new-comment-convention', /post a NEW comment/i.test(
		text,
	), 'must DOCUMENT the "post a new comment to signal an edit" convention ' +
		'(Decision 2) so a human knows how to drive re-evaluation.');

	// --- The policy is derived in the lock job, from trusted inputs --------------
	// The document mode and the origin-trust stamp are derived by the called
	// workflow's LOCK job (`ci-phase-intake.ts`), never by the agent: this
	// workflow must not derive them itself any more, nor carry a gate env.
	require('no-gate-env-auto-build', !/DORFL_AUTO_BUILD\s*:/.test(
		operative,
	), 'the workflow must NOT emit a `DORFL_AUTO_BUILD:` env assignment (env ' +
		'carries no defaults — else the env SHADOWS the committed dorfl.json).');
	require('no-gate-env-auto-task', !/DORFL_AUTO_TASK\s*:/.test(
		operative,
	), 'the workflow must NOT emit a `DORFL_AUTO_TASK:` env assignment (env ' +
		'carries no defaults — else the env SHADOWS the committed dorfl.json).');
	require('documents-policy-derivation', /OWNER\/MEMBER\/COLLABORATOR/.test(
		text,
	) &&
		/intakeIntegration \?\? integration/.test(
			text,
		), "must DOCUMENT where the policy comes from: the lock job's origin trust " +
		'(OWNER/MEMBER/COLLABORATOR, from the event) and document mode ' +
		'(`intakeIntegration ?? integration`, from dorfl.json at the base).');

	// --- Insertion point E: the issue-thread review surface ---------------------
	require('issues-write-permission', /\bissues:\s*write\b/.test(
		operative,
	), 'must grant `issues: write` so the review verdict / clarifying question ' +
		'can be posted back into the issue thread (insertion point E).');
	require('no-pr-comment-seam', !/postPRComment\b/.test(
		operative,
	), 'insertion point E posts to the ISSUE thread (postIssueComment by number), ' +
		'NOT the PR seam `postPRComment` (by url) — do not use the PR seam.');

	// --- CI runs IN-PLACE: no isolation machinery ------------------------------
	require('no-isolated-flag', !/--isolated\b/.test(
		operative,
	), 'CI runs IN-PLACE (the container IS the isolation): no `--isolated` flag.');
	require('no-remote-flag', !/--remote(?![-\w])/.test(
		operative,
	), 'CI runs IN-PLACE: no `--remote` flag (laptop-only affordance).');

	// --- A PER-ISSUE concurrency group ------------------------------------------
	require('concurrency-group', /\bconcurrency:\s*[\s\S]*?group:/.test(
		text,
	), 'must carry a CI `concurrency.group` so overlapping ticks never collide.');
	require('per-issue-concurrency', /concurrency:\s*[\s\S]*?group:[^\n]*github\.event\.issue\.number/.test(
		text,
	), 'the concurrency group must be PER-ISSUE (keyed by the issue number) so ' +
		'different issues still run in parallel.');

	// --- US #9: NO `workflows` permission; cannot self-edit triggers ------------
	require('no-workflows-permission', !/\bworkflows:\s*write\b/.test(
		text,
	), 'the running job must request NO `workflows` permission (US #9: it can ' +
		'never edit `.github/workflows/**` / rewrite its own triggers).');
	// Calling a reusable workflow (`uses: ./.github/workflows/...`) is not a
	// step touching the tree; anything else naming it is.
	require('never-edits-dot-github-workflows', !/\.github\/workflows\//.test(
		operative
			.split('\n')
			.filter((line) => !/^\s*uses: \.\/\.github\/workflows\//.test(line))
			.join('\n'),
	), 'no emitted job step may touch `.github/workflows/**` (US #9).');

	return {ok: problems.length === 0, problems};
}
