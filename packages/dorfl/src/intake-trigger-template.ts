/**
 * The `install-ci` ISSUE-INTAKE capability (spec `runner-in-ci`, task
 * `install-ci-intake-trigger-and-review-surface`; capability D: consider incoming
 * issues → task/spec, AND insertion point E: surface the review verdict back into
 * the issue thread). This module GENERATES the one fixed intake workflow file and
 * STRUCTURALLY VALIDATES it, mirroring the snapshot-assertion style of
 * `advance-lifecycle-template.ts` / `advance-ci-template.ts` (the package depends on
 * NO YAML lib, so the checks are presence/shape assertions over the raw text). It
 * ALSO carries the PURE author-trust → per-outcome-flags DERIVATION
 * ({@link deriveIntakeFlags}) — CI's merge-vs-propose POLICY, the load-bearing
 * testable logic the workflow encodes at runtime.
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
 *     (`dorfl:intake`). It invokes `intake <N>` (EXPLICIT, four-outcome
 *     dispatch) — never a bare slug.
 *   - EVENT→`IntakeEventKind` MAPPING (Decision 2: no edit-detection): only a
 *     CREATED `issue_comment` (and an opened issue / the label) drives
 *     (re-)evaluation; an EDITED comment is NOT a trigger (the ID-based
 *     `seen=<ids>` watermark suffices). The "post a NEW comment to signal an edit"
 *     convention is documented in the workflow so a human knows to re-trigger.
 *   - AUTHOR-TRUST → PLACEMENT + the STAMP, never the file-emit MODE (ADR
 *     `untrusted-origin-carries-via-stamp-not-forced-staging`; {@link
 *     deriveIntakeFlags}): author-trust NO LONGER derives the task/spec
 *     merge-vs-propose file-emit mode. It feeds exactly (1) the `--origin-trust`
 *     STAMP (`author_association` not in OWNER/MEMBER/COLLABORATOR ⇒ `untrusted`)
 *     and (2) — via that stamp, read by `intake`'s dispatch — which PLACEMENT
 *     default (`untrusted*LandIn` vs `*LandIn`) the emitted document lands in. The
 *     file-emit MODE is now GATE-DERIVED for BOTH types (`--merge-*` iff the
 *     matching auto-gate is OFF, else `--propose-*`), symmetric and
 *     trust-independent. Untrusted safety is the CARRIED stamp (it forces the
 *     BUILD transition to a code PR) plus the placement default, NOT a forced
 *     document PR. A document therefore merges to `main` regardless of who filed
 *     the issue; whether it is later reviewed-as-a-PR is the operator's
 *     per-transition config, not a trust consequence.
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
 *     `workflows` permission and cannot rewrite its own triggers. It needs
 *     `contents: write` + `pull-requests: write` (emit/propose the artifact) +
 *     `issues: write` (post the clarifying/review comment back).
 *
 * The structural validator is the dependency-free counterpart of "the workflow
 * parses + carries the right discipline" the task's acceptance criteria require;
 * the test generates this artifact under `--fake` and asserts every invariant.
 */

import {brand} from './brand.js';
import type {ResolvedCIConfig} from './install-ci-core.js';
import {providerSecretsWithBlock} from './install-ci-core.js';

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
 * Both modes are GATE-DERIVED and trust-INDEPENDENT (ADR
 * `untrusted-origin-carries-via-stamp-not-forced-staging`): author-trust NO
 * LONGER composes into the task file-emit mode. The trust signal rides only
 * {@link originTrust} (the stamp), which `intake`'s dispatch reads to select the
 * untrusted-side PLACEMENT default. So `spec`/`task` here answer "does the
 * DOCUMENT merge or open a PR", derived purely from the operator/config gates —
 * never from who filed the issue.
 */
export interface IntakeIntegrationFlags {
	/**
	 * The spec outcome's mode → `--merge-spec` / `--propose-spec`. GATE-DERIVED:
	 * `merge` iff `autoTask` is OFF, else `propose`.
	 */
	spec: 'merge' | 'propose';
	/**
	 * The task outcome's mode → `--merge-task` / `--propose-task`. GATE-DERIVED:
	 * `merge` iff `autoBuild` is OFF, else `propose` — SYMMETRIC with {@link spec}
	 * (ADR `untrusted-origin-carries-via-stamp-not-forced-staging`). Author-trust
	 * no longer forces this to `propose`; an untrusted author's task DOCUMENT now
	 * merges to `main` (the untrusted safety is the carried {@link originTrust}
	 * stamp — which forces the BUILD to a code PR — plus the placement default,
	 * NOT a forced document PR).
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

/** The gate state CI reads to derive the per-outcome file-emit modes. */
export interface IntakeGateState {
	/**
	 * `autoBuild` — whether an agent will AUTO-BUILD an undeclared task next. ON ⇒
	 * a task DOCUMENT needs a human PR checkpoint NOW (`--propose-task`); OFF ⇒ a
	 * human must build it, so it may `--merge-task`. GATE-derived only —
	 * author-trust no longer composes into this decision (ADR
	 * `untrusted-origin-carries-via-stamp-not-forced-staging`).
	 */
	autoBuild: boolean;
	/**
	 * `autoTask` — whether an agent will AUTO-TASK an undeclared spec next. ON ⇒ a
	 * spec needs a human PR checkpoint NOW (`--propose-spec`); OFF ⇒ a human must
	 * task it, so it may `--merge-spec`.
	 */
	autoTask: boolean;
}

/**
 * DERIVE the per-outcome file-emit modes + the origin-trust stamp — CI's intake
 * POLICY (ADR `untrusted-origin-carries-via-stamp-not-forced-staging`; spec
 * `untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution`
 * US #3/#13). This is the load-bearing pure logic the workflow encodes at runtime
 * (it reads `author_association` off the event payload for the STAMP, and the
 * gate env block for the MODES):
 *
 *   - **SPEC mode** — gate-derived: `--merge-spec` iff `autoTask` is OFF (a human
 *     must task the spec before anything autonomous acts on it), else
 *     `--propose-spec`.
 *   - **TASK mode** — gate-derived, SYMMETRIC with the spec: `--merge-task` iff
 *     `autoBuild` is OFF, else `--propose-task`. Author-trust NO LONGER bites the
 *     mode: an untrusted author's task DOCUMENT merges to `main` exactly like a
 *     trusted one when the gate is off.
 *   - **ORIGIN-TRUST stamp** — the ONLY thing author-trust drives: `untrusted`
 *     iff the author is not trusted, else `trusted`. `intake`'s dispatch reads
 *     this stamp to select the untrusted-side PLACEMENT default and to force the
 *     later BUILD transition of an untrusted task to a code PR.
 *
 * So author-trust changes ONLY (a) which folder the document lands in (via the
 * stamp → `untrusted*LandIn`) and (b) the carried stamp — NEVER whether the
 * DOCUMENT is a PR. Whether a document merges or is proposed is now purely the
 * operator/config gates; "merge everything" is just both gates OFF, independent of
 * who filed the issue. The untrusted safety is the stamp (the build-time code PR)
 * plus the placement default, not a forced document PR (the ADR's core move).
 */
export function deriveIntakeFlags(options: {
	gate: IntakeGateState;
	authorTrusted: boolean;
}): IntakeIntegrationFlags {
	const {gate, authorTrusted} = options;
	// SPEC mode: gate-derived — --merge-spec iff autoTask OFF, else --propose-spec.
	const spec: 'merge' | 'propose' = gate.autoTask ? 'propose' : 'merge';
	// TASK mode: gate-derived and SYMMETRIC with the spec — --merge-task iff
	// autoBuild OFF, else --propose-task. Author-trust NO LONGER forces propose
	// here (ADR untrusted-origin-carries-via-stamp-not-forced-staging): the
	// untrusted safety is the carried stamp + the placement default, not a forced
	// DOCUMENT PR. The document merges regardless of author-trust.
	const task: 'merge' | 'propose' = gate.autoBuild ? 'propose' : 'merge';
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
 * produces byte-identical output. The workflow is a FIXED shell (ADR §6: all
 * policy is env/config, so the artifact carries no config-derived policy beyond
 * the env-block scaffolding) — `config` is accepted for parity with the
 * `CapabilityEmitter` seam and future per-config wiring, but the intake-trigger
 * shape itself is config-independent.
 *
 * The per-outcome FLAGS are DERIVED AT RUNTIME by a `bash` step that mirrors
 * {@link deriveIntakeFlags}: it reads the gate env block to set the (gate-derived)
 * `--merge-spec`/`--propose-spec` + `--merge-task`/`--propose-task` modes, and the
 * event's `author_association` to set ONLY the `--origin-trust` STAMP (which
 * carries the placement + build-PR consequence). The same rule that
 * {@link deriveIntakeFlags} unit-tests is what the workflow executes — they cannot
 * desync because the test asserts the SHELL derivation matches the function.
 */
export function generateIntakeWorkflow(config: ResolvedCIConfig): string {
	// `intake <N>` runs the prompt→verdict decision (the agent), so it needs the
	// provider secret(s) forwarded to `$GITHUB_ENV` by the setup action.
	const setupWith = providerSecretsWithBlock(config);
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
# TRIGGERS (capability D): an OPENED issue, a CREATED issue comment, and the
# \`${INTAKE_TRIGGER_LABEL}\` label. A CREATED comment is the (re-)evaluation
# trigger; an EDITED comment is deliberately NOT a trigger (the ID-based
# \`seen=<ids>\` watermark catches new comments; editing a prior comment never
# re-triggers). CONVENTION: if you edit a previous comment to answer intake's
# question, ALSO post a NEW comment noting the edit — the new comment is what drives
# re-evaluation (a fresh id the watermark catches). There is NO edit-detection /
# \`updated_at\` / body-hash tracking.
#
# AUTHOR-TRUST → PLACEMENT + the STAMP, never the file-emit MODE: because ANYBODY
# can file an issue, WHO authored it matters — but it drives only (1) the
# \`--origin-trust\` STAMP on the emitted document and (2), via that stamp read by
# \`intake\`'s dispatch, which PLACEMENT default the document lands in. It does NOT
# decide merge-vs-propose for the DOCUMENT (ADR
# untrusted-origin-carries-via-stamp-not-forced-staging). The file-emit MODE is
# GATE-DERIVED for BOTH types: \`--merge-*\` iff the matching auto-gate is OFF, else
# \`--propose-*\`. So an untrusted author's task DOCUMENT MERGES to \`main\` just
# like a trusted one; the untrusted safety is the CARRIED stamp (it forces the
# later BUILD to a code PR) plus the placement default, not a forced document PR.
# "Merge everything" is simply both gates off, independent of who filed the issue.
#
# CI runs IN-PLACE (the CI container IS the isolation): NO --isolated/--remote/
# registry (laptop-only affordances). The PER-ISSUE concurrency group below
# serialises overlapping ticks on the SAME issue; the \`processing\` lock / claim
# CAS is the real cross-run serialiser.
#
# SAFETY (US #9): the running job is FORBIDDEN from editing the workflows tree
# under .github. It requests NO \`workflows\` permission, so it can never rewrite
# its own triggers.

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
# still run in parallel.
concurrency:
  group: intake-\${{ github.event.issue.number }}
  cancel-in-progress: false

# NO \`workflows\` permission: the running job can NEVER edit the workflows tree
# under .github (US #9). \`contents: write\` + \`pull-requests: write\` emit/propose
# the artifact; \`issues: write\` posts the clarifying/review comment back into the
# thread (insertion point E). It never rewrites its triggers.
permissions:
  contents: write
  pull-requests: write
  issues: write

env:
  # ── The engine GATE FAMILY, surfaced as the DORFL_* env block ─────────
  # CI is NOT a special policy surface (ADR ci-config-policy-and-gate-family §5):
  # it runs the SAME engine gates, resolved through flag > env > per-repo > global
  # > default. The SAME dorfl.json the laptop uses applies here; this env
  # block is the optional CI-only override. Change behaviour by editing these
  # values (or a GitHub repo variable / dorfl.json key) — NOT by re-running
  # install-ci (ADR §6: install-ci is one-time).
  #
  # \`intake\` itself is GATE-FREE (the explicit invocation is its own
  # authorization), so these gates do NOT block it — CI READS them to DERIVE the
  # per-outcome merge-vs-propose flags below (the merge-vs-propose POLICY). CALM
  # DEFAULTS: both off ⇒ the next step is a HUMAN, so the gate-derived mode is the
  # permissive merge side; author-trust then forces propose for a task from an
  # untrusted author.
  DORFL_AUTO_BUILD: 'false' # gate: will an agent auto-build the emitted task next?
  DORFL_AUTO_TASK: 'false' # gate: will an agent auto-task the emitted spec next?

jobs:
  intake:
    # Only run for an issue/comment that actually carries an issue number (a
    # comment on a PR also fires \`issue_comment\`; skip those — there is no issue to
    # intake). \`pull_request\` is absent on a real issue comment.
    if: \${{ github.event.issue.number && !github.event.issue.pull_request }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: ./.github/actions/dorfl-setup${setupWith}

      - name: derive the per-outcome file-emit modes (gate) + the origin-trust stamp (author-trust)
        id: policy
        # The intake POLICY, executed at runtime — the SAME rule
        # \`deriveIntakeFlags\` unit-tests (they cannot desync; the test asserts this
        # shell matches the function). Author-trust drives ONLY the stamp +
        # placement, NEVER the file-emit mode (ADR
        # untrusted-origin-carries-via-stamp-not-forced-staging):
        #   * SPEC mode — gate-derived: --merge-spec iff autoTask OFF (a human tasks
        #            it before anything autonomous acts), else --propose-spec.
        #   * TASK mode — gate-derived, SYMMETRIC: --merge-task iff autoBuild OFF,
        #            else --propose-task. Author-trust does NOT bite it — an
        #            untrusted author's task DOCUMENT merges just like a trusted one.
        #   * ORIGIN-TRUST stamp — the ONLY thing author-trust drives: --origin-trust
        #            untrusted iff the author is not OWNER/MEMBER/COLLABORATOR, which
        #            \`intake\`'s dispatch reads to select the untrusted PLACEMENT
        #            default and to force the later BUILD to a code PR.
        # author_association comes from the COMMENT on an \`issue_comment\` event,
        # else the ISSUE on an \`issues\` event — read straight off the payload, no
        # extra API call.
        env:
          AUTHOR_ASSOCIATION: \${{ github.event.comment.author_association || github.event.issue.author_association }}
        run: |
          set -euo pipefail

          # SPEC flag: gate-derived only (author-trust does NOT bite a spec).
          if [ "\${DORFL_AUTO_TASK}" = "true" ]; then
            spec_flag="--propose-spec"
          else
            spec_flag="--merge-spec"
          fi

          # TASK flag: gate-derived, SYMMETRIC with the spec above — --merge-task
          # iff autoBuild OFF, else --propose-task. Author-trust does NOT bite the
          # mode (ADR untrusted-origin-carries-via-stamp-not-forced-staging): an
          # untrusted author's task DOCUMENT merges just like a trusted one; the
          # untrusted safety is the stamp + placement below, not a document PR.
          if [ "\${DORFL_AUTO_BUILD}" = "true" ]; then
            task_flag="--propose-task"
          else
            task_flag="--merge-task"
          fi

          # Author-trust: TRUSTED iff OWNER/MEMBER/COLLABORATOR (admin / write-
          # collaborator — the whole signal). Anything else (incl. empty) is
          # UNTRUSTED. It drives ONLY the origin-trust stamp below (NOT the modes).
          trusted="false"
          case "\${AUTHOR_ASSOCIATION:-}" in
            OWNER|MEMBER|COLLABORATOR) trusted="true" ;;
          esac

          # ORIGIN-TRUST stamp — the SOLE thing author-trust drives on the wire
          # (task untrusted-origin-forces-build-propose). \`intake\` STAMPS this
          # onto the emitted spec/task frontmatter (origin: issue + originTrust:
          # <value>); its dispatch reads the stamp to (1) select the untrusted-side
          # PLACEMENT default (\`untrusted*LandIn\`) and (2) force the later BUILD of
          # an untrusted task to a code PR. It does NOT re-resolve trust (that is
          # CI's policy, passed IN). The stamp SURVIVES the merge boundary so a
          # later auto-task/auto-build of an untrusted-origin artifact still forces
          # a human becomes-code checkpoint (the laundering gap is closed).
          if [ "\${trusted}" = "true" ]; then
            origin_trust_flag="--origin-trust=trusted"
          else
            origin_trust_flag="--origin-trust=untrusted"
          fi

          echo "spec_flag=\${spec_flag}" >> "\$GITHUB_OUTPUT"
          echo "task_flag=\${task_flag}" >> "\$GITHUB_OUTPUT"
          echo "origin_trust_flag=\${origin_trust_flag}" >> "\$GITHUB_OUTPUT"
          echo "intake policy: author_association='\${AUTHOR_ASSOCIATION:-}' trusted=\${trusted} → \${spec_flag} \${task_flag} \${origin_trust_flag}"

      - name: intake the issue (four-outcome dispatch; surfaces the review verdict into the thread)
        # In-place in this checkout (no --isolated/--remote): the CI container IS
        # the isolation. EXPLICIT \`intake <N>\`, never a bare slug. The per-outcome
        # flags carry the (gate-derived) file-emit modes + the origin-trust stamp
        # derived above (author-trust drives only the stamp + placement, not the
        # document merge-vs-propose). \`intake\` runs the
        # lone-task review/edit loop and posts its findings as questions back into
        # THIS issue thread (insertion point E) through the issue-comment seam —
        # CI surfaces E by invoking intake; it adds no new review mechanism.
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          dorfl intake "\${{ github.event.issue.number }}" \\
            "\${{ steps.policy.outputs.spec_flag }}" \\
            "\${{ steps.policy.outputs.task_flag }}" \\
            "\${{ steps.policy.outputs.origin_trust_flag }}" \\
            --arbiter origin
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

	// --- INVOKES `intake <N>` (explicit, four-outcome dispatch), never bare ------
	require('invokes-intake', /dorfl intake\b/.test(
		operative,
	), 'must invoke `dorfl intake <N>` (the four-outcome dispatch engine CI ' +
		'schedules).');
	// The issue number rides the explicit positional — never a bare slug, and the
	// number comes from the event payload (the issue under intake).
	require('intake-explicit-issue-number', /dorfl intake "?\$\{\{\s*github\.event\.issue\.number/.test(
		operative,
	), 'the intake invocation must pass the explicit issue NUMBER ' +
		'(`github.event.issue.number`), never a bare slug.');
	// CI owns ONLY the trigger/policy/delivery — it must NOT invoke a build/task
	// verb (that is the build/task tick), nor re-implement the transform.
	require('no-build-verbs', !/dorfl (?:do|advance)\b/.test(
		operative,
	), 'the intake workflow must invoke ONLY `intake` (+ derive the policy), not a ' +
		'build/task verb — CI owns the trigger + merge policy, not the transform.');

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

	// --- Decision 2: a CREATED comment triggers; an EDITED comment does NOT ------
	// The `issue_comment` trigger must NOT list `edited` (no edit-detection); and
	// there must be no `updated_at`/body-hash edit-tracking wiring.
	require('no-comment-edited-trigger', !/issue_comment:\s*[\s\S]*?types:\s*[\s\S]*?-\s*edited\b/.test(
		text,
	), 'the `issue_comment` trigger must NOT include `edited` (Decision 2: no ' +
		'edit-detection; a CREATED comment is the (re-)evaluation trigger).');
	require('no-edit-tracking', !/updated_at|body-hash|bodyHash/.test(
		operative,
	), 'must NOT implement `updated_at` / body-hash edit-tracking (Decision 2).');
	// The "post a NEW comment to signal an edit" CONVENTION must be documented in
	// the workflow so a human knows how to re-trigger after editing a comment.
	require('documents-new-comment-convention', /post a NEW comment/i.test(
		text,
	), 'must DOCUMENT the "post a new comment to signal an edit" convention ' +
		'(Decision 2) so a human knows how to drive re-evaluation.');

	// --- AUTHOR-TRUST → per-outcome flags (Decision 1) --------------------------
	// The workflow must READ author_association off the event payload (no extra API).
	require('reads-author-association', /author_association/.test(
		text,
	), 'must read `author_association` off the event payload to compose author-' +
		'trust into the merge-vs-propose policy (Decision 1; no extra API call).');
	// Trust = OWNER/MEMBER/COLLABORATOR (the whole signal).
	require('trust-owner-member-collaborator', /OWNER\|MEMBER\|COLLABORATOR|OWNER[\s\S]{0,40}MEMBER[\s\S]{0,40}COLLABORATOR/.test(
		text,
	), 'author-trust must be OWNER/MEMBER/COLLABORATOR (admin / write-collaborator ' +
		'— the whole signal; Decision 1).');
	// The task mode is GATE-DERIVED (author-trust no longer bites it; ADR
	// untrusted-origin-carries-via-stamp-not-forced-staging): the derivation must
	// emit both task modes (propose iff autoBuild ON, else merge).
	require('derives-propose-task', /--propose-task\b/.test(
		operative,
	), 'the policy derivation must be able to emit `--propose-task` (the ' +
		'autoBuild-on path).');
	require('derives-merge-task', /--merge-task\b/.test(
		operative,
	), 'the policy derivation must be able to emit `--merge-task` (the ' +
		'autoBuild-off path; a task DOCUMENT merges regardless of author-trust).');
	// --merge-spec is emitted when autoTask is OFF (author-trust does not bite it).
	require('derives-merge-spec', /--merge-spec\b/.test(
		operative,
	), 'the policy derivation must be able to emit `--merge-spec` (autoTask off ' +
		'— the human-tasks-it checkpoint stays ahead).');
	require('derives-propose-spec', /--propose-spec\b/.test(
		operative,
	), 'the policy derivation must be able to emit `--propose-spec` (autoTask on).');
	// ORIGIN-TRUST stamp (task untrusted-origin-forces-build-propose): the shell
	// must derive `--origin-trust <trusted|untrusted>` from the SAME author-trust
	// case it uses for the task/SPEC modes, and pass it to `intake` so the emitted
	// artifact is stamped (the stamp + the modes cannot desync).
	require('derives-origin-trust-untrusted', /--origin-trust=untrusted\b/.test(
		operative,
	), 'the policy derivation must emit `--origin-trust=untrusted` for a non-trusted ' +
		'author (so the emitted artifact is stamped untrusted; task ' +
		'untrusted-origin-forces-build-propose).');
	require('derives-origin-trust-trusted', /--origin-trust=trusted\b/.test(
		operative,
	), 'the policy derivation must emit `--origin-trust=trusted` for a trusted author.');
	require('passes-origin-trust-to-intake', /steps\.policy\.outputs\.origin_trust_flag/.test(
		operative,
	), 'the intake invocation must pass the derived `--origin-trust` flag (the ' +
		'stamp must reach `dorfl intake`).');
	// The derivation must compose the gate env block (it READS the gates to derive).
	require('reads-auto-build-gate', /DORFL_AUTO_BUILD\b/.test(
		text,
	), 'the policy derivation must read the `DORFL_AUTO_BUILD` gate.');
	require('reads-auto-task-gate', /DORFL_AUTO_TASK\b/.test(
		text,
	), 'the policy derivation must read the `DORFL_AUTO_TASK` gate.');

	// --- Insertion point E: the issue-thread review surface ---------------------
	// E is REUSED via `intake` (which runs the lone-task review and posts to the
	// thread). The workflow must request `issues: write` so that comment can land.
	require('issues-write-permission', /\bissues:\s*write\b/.test(
		operative,
	), 'must request `issues: write` so the review verdict / clarifying question ' +
		'can be posted back into the issue thread (insertion point E).');
	// It must NOT route the review verdict through the PR-comment seam — E posts to
	// the ISSUE (postIssueComment by number), NOT the PR (postPRComment by url).
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
	require('never-edits-dot-github-workflows', !/\.github\/workflows\//.test(
		operative,
	), 'no emitted job step may touch `.github/workflows/**` (US #9).');

	// --- Wires the SHARED composite setup action -------------------------------
	require('uses-shared-setup-action', /uses:\s*\.\/\.github\/actions\/dorfl-setup\b/.test(
		text,
	), 'the job must wire the shared composite setup action ' +
		'(`./.github/actions/dorfl-setup`, emitted by the core task).');

	return {ok: problems.length === 0, problems};
}
