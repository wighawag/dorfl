/**
 * The `install-ci` ISSUE-INTAKE capability (PRD `runner-in-ci`, slice
 * `install-ci-intake-trigger-and-review-surface`; capability D: consider incoming
 * issues → slice/PRD, AND insertion point E: surface the review verdict back into
 * the issue thread). This module GENERATES the one fixed intake workflow file and
 * STRUCTURALLY VALIDATES it, mirroring the snapshot-assertion style of
 * `build-slice-tick-template.ts` / `advance-ci-template.ts` (the package depends on
 * NO YAML lib, so the checks are presence/shape assertions over the raw text). It
 * ALSO carries the PURE author-trust → per-outcome-flags DERIVATION
 * ({@link deriveIntakeFlags}) — CI's merge-vs-propose POLICY, the load-bearing
 * testable logic the workflow encodes at runtime.
 *
 * SCOPE FENCE (PRD Out-of-Scope): the issue→artifact TRANSFORM engine is
 * `issue-intake`'s (`intake <N>` + its four-outcome dispatch + the per-outcome
 * KNOBS + the lone-slice review that posts to the issue thread). CI only
 * WIRES/SCHEDULES/INVOKES it and owns the merge-vs-propose POLICY + the delivery
 * surface. This module emits NO transform; it emits the WORKFLOW that calls it.
 *
 * The discipline (PRD capability-D row + the merge-vs-propose POLICY + the two
 * RESOLVED design decisions in the slice):
 *
 *   - TRIGGERS: `issues` opened, `issue_comment` created, and a label
 *     (`agent-runner:intake`). It invokes `intake <N>` (EXPLICIT, four-outcome
 *     dispatch) — never a bare slug.
 *   - EVENT→`IntakeEventKind` MAPPING (Decision 2: no edit-detection): only a
 *     CREATED `issue_comment` (and an opened issue / the label) drives
 *     (re-)evaluation; an EDITED comment is NOT a trigger (the ID-based
 *     `seen=<ids>` watermark suffices). The "post a NEW comment to signal an edit"
 *     convention is documented in the workflow so a human knows to re-trigger.
 *   - AUTHOR-TRUST → per-outcome FLAGS (Decision 1, {@link deriveIntakeFlags}): an
 *     UNTRUSTED author (`author_association` not in OWNER/MEMBER/COLLABORATOR)
 *     forces `--propose-slice` REGARDLESS of the `autoBuild` gate, while
 *     `--merge-prd` stays allowed (a human still slices a PRD before anything
 *     autonomous acts — the checkpoint is intact). A TRUSTED author gets the plain
 *     gate-derived mode for both. The fully-gateless "all gates on + merge
 *     everywhere" path is a LOUD, NON-DEFAULT opt-in — the default is conservative
 *     (propose / human-in-the-loop).
 *   - INSERTION POINT E (the issue-thread review surface): the review verdict over
 *     intake's generated PRD/slices is surfaced into the ISSUE THREAD via the
 *     `IssueProvider.postIssueComment` seam (issue thread, by NUMBER — NOT the PR
 *     seam `postPRComment`, which is keyed by url). This is REUSED, not new:
 *     `intake <N>` already runs the lone-slice review/edit loop and posts its
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
 * parses + carries the right discipline" the slice's acceptance criteria require;
 * the test generates this artifact under `--fake` and asserts every invariant.
 */

import {brand} from './brand.js';
import type {ResolvedCIConfig} from './install-ci-core.js';

/** The capability id (the registry key + the emitted workflow file stem). */
export const INTAKE_TRIGGER_CAPABILITY_ID = 'intake';

/** The wizard-facing label for the issue-intake capability. */
export const INTAKE_TRIGGER_CAPABILITY_LABEL =
	'Consider incoming issues → slice/PRD + surface the review verdict into the issue thread (the intake trigger: issues / issue_comment / label)';

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
 */
export interface IntakeIntegrationFlags {
	/** The PRD outcome's mode → `--merge-prd` / `--propose-prd`. */
	prd: 'merge' | 'propose';
	/** The slice outcome's mode → `--merge-slice` / `--propose-slice`. */
	slice: 'merge' | 'propose';
	/**
	 * The ORIGIN-TRUST verdict CI passes to `intake <N>` via `--origin-trust`
	 * (slice `untrusted-origin-forces-build-propose`) so the emitted PRD/slice is
	 * STAMPED with how it was born. Derived from the SAME `author_association` case
	 * as the integration flags (it IS `authorTrusted` collapsed to the wire value),
	 * so the stamp and the integration mode CANNOT desync. `intake.ts` writes it
	 * verbatim onto the frontmatter — it never re-resolves trust (the `intake.ts`
	 * ~L296 boundary: author-trust is CI's POLICY, passed IN, not resolved here).
	 */
	originTrust: 'trusted' | 'untrusted';
}

/** The gate state CI composes with author-trust to derive the per-outcome flags. */
export interface IntakeGateState {
	/**
	 * `autoBuild` — whether an agent will AUTO-BUILD an undeclared slice next. ON ⇒
	 * a slice needs a human PR checkpoint NOW (`--propose-slice`); OFF ⇒ a human
	 * must build it, so it may `--merge-slice` (when the author is also trusted).
	 */
	autoBuild: boolean;
	/**
	 * `autoSlice` — whether an agent will AUTO-SLICE an undeclared PRD next. ON ⇒ a
	 * PRD needs a human PR checkpoint NOW (`--propose-prd`); OFF ⇒ a human must
	 * slice it, so it may `--merge-prd`.
	 */
	autoSlice: boolean;
}

/**
 * DERIVE the per-outcome merge-vs-propose flags from the gate state COMPOSED with
 * author-trust — CI's merge-vs-propose POLICY (PRD "merge-vs-propose POLICY" +
 * "Composed with AUTHOR-TRUST"; slice Decision 1). This is the load-bearing pure
 * logic the workflow encodes at runtime (it reads `author_association` off the
 * event payload and sets the flags accordingly):
 *
 *   - **PRD** — gate-derived ONLY (author-trust does NOT bite): `--merge-prd` iff
 *     `autoSlice` is OFF (a human must slice the PRD before anything autonomous
 *     acts on it — the human checkpoint stays AHEAD even for an untrusted author),
 *     else `--propose-prd`.
 *   - **SLICE** — `--propose-slice` iff (`autoBuild` ON) OR (author UNTRUSTED);
 *     `--merge-slice` ONLY iff (`autoBuild` OFF AND author TRUSTED). An untrusted
 *     author can never auto-merge a slice from a public-front-door issue.
 *
 * So the only way to `--merge-slice` is a TRUSTED author with `autoBuild` OFF —
 * and the fully-gateless "merge everything" path additionally needs `autoSlice`
 * OFF; both gates off + a trusted author is the LOUD, NON-DEFAULT opt-in. The
 * conservative case (untrusted author, or any gate on) keeps a human in the loop.
 */
export function deriveIntakeFlags(options: {
	gate: IntakeGateState;
	authorTrusted: boolean;
}): IntakeIntegrationFlags {
	const {gate, authorTrusted} = options;
	// PRD: gate-derived only — a human-slices-it checkpoint stays ahead regardless
	// of author-trust, so an untrusted author may still --merge-prd.
	const prd: 'merge' | 'propose' = gate.autoSlice ? 'propose' : 'merge';
	// SLICE: propose if the agent will auto-build it (gate ON) OR the author is
	// untrusted; merge ONLY when both are safe (gate OFF AND author trusted).
	const slice: 'merge' | 'propose' =
		gate.autoBuild || !authorTrusted ? 'propose' : 'merge';
	// ORIGIN-TRUST stamp (slice `untrusted-origin-forces-build-propose`): the SAME
	// author-trust verdict, collapsed to the wire value `intake` stamps onto the
	// emitted artifact. Derived HERE — next to the integration flags, off the SAME
	// `authorTrusted` input — so the stamp and the slice/PRD modes cannot desync.
	// It is NOT a re-resolution of trust (CI already resolved it); it is the verdict
	// being CARRIED so it survives the PRD/slice merge boundary (the becomes-code
	// checkpoint is not laundered when the file lands on main).
	const originTrust: 'trusted' | 'untrusted' = authorTrusted
		? 'trusted'
		: 'untrusted';
	return {prd, slice, originTrust};
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
 * {@link deriveIntakeFlags}: it reads the gate env block + the event's
 * `author_association` and sets `--merge-prd`/`--propose-prd` +
 * `--merge-slice`/`--propose-slice` accordingly. The same rule that
 * {@link deriveIntakeFlags} unit-tests is what the workflow executes — they cannot
 * desync because the test asserts the SHELL derivation matches the function.
 */
export function generateIntakeWorkflow(_config: ResolvedCIConfig): string {
	return `\
# agent-runner — the ISSUE INTAKE trigger in CI (capability D: consider incoming
# issues → slice/PRD, PLUS insertion point E: surface the review verdict into the
# issue thread, PRD runner-in-ci). EMITTED by \`agent-runner install-ci\`; the human
# commits it. DO NOT hand-edit a copy — re-run install-ci to upgrade the shell.
#
# WHAT IT DOES — \`agent-runner intake <N>\` reads issue #N + its comment thread,
# runs a prompt→verdict decision (ask / slice / PRD / bounce), and dispatches it.
# CI owns ONLY the trigger + the merge-vs-propose POLICY + the delivery surface;
# the TRANSFORM is the engine's (the Out-of-Scope fence — CI re-implements none of
# it). The lone-slice review/edit loop \`intake\` already runs ALSO surfaces its
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
# AUTHOR-TRUST → per-outcome FLAGS (the merge-vs-propose POLICY): because ANYBODY
# can file an issue, the merge decision composes with WHO authored it. An UNTRUSTED
# author (\`author_association\` not OWNER/MEMBER/COLLABORATOR) forces
# \`--propose-slice\` REGARDLESS of the \`autoBuild\` gate — a slice from a public
# front-door issue can never auto-merge — while \`--merge-prd\` stays allowed (a
# human must still slice a PRD before anything autonomous acts on it, so the human
# checkpoint is intact). A TRUSTED author gets the plain gate-derived mode. The
# fully-gateless "merge everything" path (both gates off + a trusted author) is a
# LOUD, NON-DEFAULT opt-in; the default is conservative (propose).
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
  # ── The engine GATE FAMILY, surfaced as the AGENT_RUNNER_* env block ─────────
  # CI is NOT a special policy surface (ADR ci-config-policy-and-gate-family §5):
  # it runs the SAME engine gates, resolved through flag > env > per-repo > global
  # > default. The SAME .agent-runner.json the laptop uses applies here; this env
  # block is the optional CI-only override. Change behaviour by editing these
  # values (or a GitHub repo variable / .agent-runner.json key) — NOT by re-running
  # install-ci (ADR §6: install-ci is one-time).
  #
  # \`intake\` itself is GATE-FREE (the explicit invocation is its own
  # authorization), so these gates do NOT block it — CI READS them to DERIVE the
  # per-outcome merge-vs-propose flags below (the merge-vs-propose POLICY). CALM
  # DEFAULTS: both off ⇒ the next step is a HUMAN, so the gate-derived mode is the
  # permissive merge side; author-trust then forces propose for a slice from an
  # untrusted author.
  AGENT_RUNNER_AUTO_BUILD: 'false' # gate: will an agent auto-build the emitted slice next?
  AGENT_RUNNER_AUTO_SLICE: 'false' # gate: will an agent auto-slice the emitted PRD next?

jobs:
  intake:
    # Only run for an issue/comment that actually carries an issue number (a
    # comment on a PR also fires \`issue_comment\`; skip those — there is no issue to
    # intake). \`pull_request\` is absent on a real issue comment.
    if: \${{ github.event.issue.number && !github.event.issue.pull_request }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/agent-runner-setup

      - name: derive the per-outcome merge-vs-propose flags (gate × author-trust)
        id: policy
        # The merge-vs-propose POLICY, executed at runtime — the SAME rule
        # \`deriveIntakeFlags\` unit-tests (they cannot desync; the test asserts this
        # shell matches the function):
        #   * PRD  — gate-derived ONLY: --merge-prd iff autoSlice OFF (a human
        #            slices it before anything autonomous acts — the checkpoint
        #            stays ahead even for an UNTRUSTED author), else --propose-prd.
        #   * SLICE — --propose-slice iff (autoBuild ON) OR (author UNTRUSTED);
        #            --merge-slice ONLY iff (autoBuild OFF AND author TRUSTED).
        # author_association comes from the COMMENT on an \`issue_comment\` event,
        # else the ISSUE on an \`issues\` event — read straight off the payload, no
        # extra API call.
        env:
          AUTHOR_ASSOCIATION: \${{ github.event.comment.author_association || github.event.issue.author_association }}
        run: |
          set -euo pipefail

          # PRD flag: gate-derived only (author-trust does NOT bite a PRD).
          if [ "\${AGENT_RUNNER_AUTO_SLICE}" = "true" ]; then
            prd_flag="--propose-prd"
          else
            prd_flag="--merge-prd"
          fi

          # Author-trust: TRUSTED iff OWNER/MEMBER/COLLABORATOR (admin / write-
          # collaborator — the whole signal). Anything else (incl. empty) is
          # UNTRUSTED → the conservative, human-in-the-loop path.
          trusted="false"
          case "\${AUTHOR_ASSOCIATION:-}" in
            OWNER|MEMBER|COLLABORATOR) trusted="true" ;;
          esac

          # SLICE flag: propose if the agent will auto-build it (gate ON) OR the
          # author is untrusted; merge ONLY when both are safe.
          if [ "\${AGENT_RUNNER_AUTO_BUILD}" = "true" ] || [ "\${trusted}" != "true" ]; then
            slice_flag="--propose-slice"
          else
            slice_flag="--merge-slice"
          fi

          # ORIGIN-TRUST stamp (slice untrusted-origin-forces-build-propose):
          # derived from the SAME \${trusted} case above (one author-trust read,
          # two consumers — the slice/PRD modes AND the stamp — so they cannot
          # desync). \`intake\` STAMPS this onto the emitted PRD/slice frontmatter
          # (origin: issue + originTrust: <value>); it does NOT re-resolve trust
          # (that is CI's policy, passed IN). The stamp SURVIVES the merge boundary
          # so a later auto-slice/auto-build of an untrusted-origin artifact still
          # forces a human becomes-code checkpoint (the laundering gap is closed).
          if [ "\${trusted}" = "true" ]; then
            origin_trust_flag="--origin-trust=trusted"
          else
            origin_trust_flag="--origin-trust=untrusted"
          fi

          echo "prd_flag=\${prd_flag}" >> "\$GITHUB_OUTPUT"
          echo "slice_flag=\${slice_flag}" >> "\$GITHUB_OUTPUT"
          echo "origin_trust_flag=\${origin_trust_flag}" >> "\$GITHUB_OUTPUT"
          echo "intake policy: author_association='\${AUTHOR_ASSOCIATION:-}' trusted=\${trusted} → \${prd_flag} \${slice_flag} \${origin_trust_flag}"

      - name: intake the issue (four-outcome dispatch; surfaces the review verdict into the thread)
        # In-place in this checkout (no --isolated/--remote): the CI container IS
        # the isolation. EXPLICIT \`intake <N>\`, never a bare slug. The per-outcome
        # flags carry the merge-vs-propose POLICY derived above. \`intake\` runs the
        # lone-slice review/edit loop and posts its findings as questions back into
        # THIS issue thread (insertion point E) through the issue-comment seam —
        # CI surfaces E by invoking intake; it adds no new review mechanism.
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          agent-runner intake "\${{ github.event.issue.number }}" \\
            "\${{ steps.policy.outputs.prd_flag }}" \\
            "\${{ steps.policy.outputs.slice_flag }}" \\
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
 * Structurally validate the intake-trigger workflow against the slice's acceptance
 * criteria. Dependency-free (no YAML lib): presence/shape assertions over the raw
 * text, mirroring {@link validateBuildSliceTickWorkflow} /
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
	require('invokes-intake', /agent-runner intake\b/.test(
		operative,
	), 'must invoke `agent-runner intake <N>` (the four-outcome dispatch engine CI ' +
		'schedules).');
	// The issue number rides the explicit positional — never a bare slug, and the
	// number comes from the event payload (the issue under intake).
	require('intake-explicit-issue-number', /agent-runner intake "?\$\{\{\s*github\.event\.issue\.number/.test(
		operative,
	), 'the intake invocation must pass the explicit issue NUMBER ' +
		'(`github.event.issue.number`), never a bare slug.');
	// CI owns ONLY the trigger/policy/delivery — it must NOT invoke a build/slice
	// verb (that is the build/slice tick), nor re-implement the transform.
	require('no-build-verbs', !/agent-runner (?:do|advance)\b/.test(
		operative,
	), 'the intake workflow must invoke ONLY `intake` (+ derive the policy), not a ' +
		'build/slice verb — CI owns the trigger + merge policy, not the transform.');

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
	// An untrusted author forces --propose-slice; the derivation must emit both
	// slice modes (so the untrusted path can reach propose and the trusted-safe
	// path can reach merge).
	require('derives-propose-slice', /--propose-slice\b/.test(
		operative,
	), 'the policy derivation must be able to emit `--propose-slice` (the ' +
		'untrusted-author / autoBuild-on fallback).');
	require('derives-merge-slice', /--merge-slice\b/.test(
		operative,
	), 'the policy derivation must be able to emit `--merge-slice` (the ' +
		'trusted-author + autoBuild-off path).');
	// --merge-prd stays allowed even for an untrusted author (PRD checkpoint ahead).
	require('derives-merge-prd', /--merge-prd\b/.test(
		operative,
	), 'the policy derivation must be able to emit `--merge-prd` (a PRD stays ' +
		'mergeable even for an untrusted author — the human-slices-it checkpoint).');
	require('derives-propose-prd', /--propose-prd\b/.test(
		operative,
	), 'the policy derivation must be able to emit `--propose-prd` (autoSlice on).');
	// ORIGIN-TRUST stamp (slice untrusted-origin-forces-build-propose): the shell
	// must derive `--origin-trust <trusted|untrusted>` from the SAME author-trust
	// case it uses for the slice/PRD modes, and pass it to `intake` so the emitted
	// artifact is stamped (the stamp + the modes cannot desync).
	require('derives-origin-trust-untrusted', /--origin-trust=untrusted\b/.test(
		operative,
	), 'the policy derivation must emit `--origin-trust=untrusted` for a non-trusted ' +
		'author (so the emitted artifact is stamped untrusted; slice ' +
		'untrusted-origin-forces-build-propose).');
	require('derives-origin-trust-trusted', /--origin-trust=trusted\b/.test(
		operative,
	), 'the policy derivation must emit `--origin-trust=trusted` for a trusted author.');
	require('passes-origin-trust-to-intake', /steps\.policy\.outputs\.origin_trust_flag/.test(
		operative,
	), 'the intake invocation must pass the derived `--origin-trust` flag (the ' +
		'stamp must reach `agent-runner intake`).');
	// The derivation must compose the gate env block (it READS the gates to derive).
	require('reads-auto-build-gate', /AGENT_RUNNER_AUTO_BUILD\b/.test(
		text,
	), 'the policy derivation must read the `AGENT_RUNNER_AUTO_BUILD` gate.');
	require('reads-auto-slice-gate', /AGENT_RUNNER_AUTO_SLICE\b/.test(
		text,
	), 'the policy derivation must read the `AGENT_RUNNER_AUTO_SLICE` gate.');

	// --- Insertion point E: the issue-thread review surface ---------------------
	// E is REUSED via `intake` (which runs the lone-slice review and posts to the
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
	require('uses-shared-setup-action', /uses:\s*\.\/\.github\/actions\/agent-runner-setup\b/.test(
		text,
	), 'the job must wire the shared composite setup action ' +
		'(`./.github/actions/agent-runner-setup`, emitted by the core slice).');

	return {ok: problems.length === 0, problems};
}
