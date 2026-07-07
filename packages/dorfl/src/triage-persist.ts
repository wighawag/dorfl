import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {run, type RunResult} from './git.js';
import {workItemRel} from './work-layout.js';
import {
	createItemThroughCas,
	type CasContentionBudget,
	type CreateItemThroughCasResult,
} from './advancing-lock.js';
import {resolveSidecarIdentity, sidecarPathFor} from './sidecar.js';
import type {TriageAutoKind} from './triage-gate.js';
import {renderTaskBody, renderPrdBody} from './buildable-body.js';

/**
 * The engine-owned TRIAGE PERSIST (prd `advance-loop`, task `advance-rung-triage`,
 * US #16/17/24/30) — the half of the observation-triage rung the ENGINE owns (the
 * triage gate JUDGES, the engine ACTS). It is the SIBLING of `surface-persist.ts`
 * (the surface rung's persist) and `apply-persist.ts` (the apply rung's persist),
 * kept file-orthogonal so the rung bodies land in different tasks.
 *
 * It delivers the two WRITES the triage rung needs beyond the always-allowed
 * question-gated surface path (which reuses `surface-persist.ts` verbatim):
 *
 *   1. **the conservative auto-disposition** ({@link autoDispositionObservation},
 *      US #17, `observationTriage: 'auto'`-gated): act on the no-question case on
 *      the UNTRIAGED observation in ONE local commit. BOTH no-question cases now
 *      DISCHARGE the redundant note BY DELETION (there is no resting `triaged:keep`
 *      state any more — task `agentic-apply-retire-disposition-vocabulary`):
 *        - `duplicate` → `git rm` the duplicate in a standalone commit, the
 *          duplicated-of identity + reason in the commit message (git history =
 *          archive). A duplicate is a redundant copy of an already-captured signal,
 *          so deleting it loses nothing; or
 *        - `map` → the note is already covered by the existing item it maps onto, so
 *          it is settled — `git rm` it in a standalone commit, the mapped-onto
 *          identity + reason recorded in the commit message (mirroring `duplicate`).
 *          There is no resting `triaged:keep` note any more.
 *   2. **promote → SELF-CONTAINED new-item creation + DELETE through the CAS**
 *      ({@link promoteObservation}, US #1/#3/#8): an ANSWERED "promote" drafts a
 *      new `work/tasks/ready/<new-slug>.md` whose body is built FROM the
 *      observation (mechanism + fix prose into `## What to build`, the
 *      `## Open questions` scoping transcribed, `needsAnswers` set when questions
 *      remain), routed THROUGH the CAS keyed on the NEW item's identity (its
 *      target path) — so the (unlikely) same-slug new-item race needs NO special
 *      case (the loser fails the CAS and backs off). On a WIN the observation +
 *      its answered sidecar are `git rm`-ed IN THE SAME atomic create commit
 *      (discharge by DELETION; the human's ratified "promote" answer authors it),
 *      so a crash never strands the note without its successor.
 *
 * Like its sibling persists, the auto-disposition is a LOCAL one-commit primitive
 * over a working tree (the throwaway-git-repo test pattern); the CAS-create (now
 * carrying the note+sidecar deletion in the SAME commit) is the ONLY arbiter race
 * (it IS the new-item-creation CAS helper from `advancing-lock-borrow`). The
 * `advancing` CAS lock that makes the triage rung WINNER-ONLY on the OBSERVATION
 * is held by `performAdvance` BEFORE this is called.
 *
 * **NEVER auto-deletes a NON-duplicate signal; NEVER auto-promotes a judgement
 * call (US #17).** The auto-disposition is bounded to `duplicate`/`map` (the gate's
 * high bar). A `duplicate` IS discharged by deletion (it is a redundant copy of an
 * already-captured signal — deleting it loses nothing, the original carries the
 * signal), which is NOT "auto-deleting a live signal". Promotion is ALWAYS a human
 * answer (the apply path), never an auto-disposition.
 */

function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	return run('git', args, cwd, {env});
}

function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	const result = run('git', args, cwd, {env});
	if (result.status !== 0) {
		throw new TriagePersistError(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result;
}

function resolveBy(cwd: string, env: NodeJS.ProcessEnv | undefined): string {
	const name = gitSoft(['config', 'user.name'], cwd, env);
	if (name.status === 0 && name.stdout.trim() !== '') {
		return name.stdout.trim();
	}
	const e = env ?? process.env;
	return e.USER ?? e.USERNAME ?? '';
}

/** Read the observation body from the tree (committed) then the working file. */
function readItem(
	cwd: string,
	itemPath: string,
	env: NodeJS.ProcessEnv | undefined,
): string {
	const show = gitSoft(['show', `:${itemPath}`], cwd, env);
	if (show.status === 0) {
		return show.stdout;
	}
	try {
		return readFileSync(join(cwd, itemPath), 'utf8');
	} catch {
		throw new TriagePersistError(
			`cannot read observation body for '${itemPath}' (the triage rung needs the item file)`,
		);
	}
}

/** Raised for usage errors (a missing repo, an unreadable observation). */
export class TriagePersistError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TriagePersistError';
	}
}

// --- The conservative auto-disposition (US #17) ---------------------------

export interface AutoDispositionOptions {
	/** Working clone/worktree the disposition commits in. */
	cwd: string;
	/** The namespaced observation identity (`observation:<slug>`). */
	item: string;
	/** The observation file path RELATIVE to `cwd` (e.g. `work/notes/observations/foo.md`). */
	itemPath: string;
	/** The no-question case (`duplicate` / `map`). */
	kind: TriageAutoKind;
	/** The existing item this duplicates / maps onto (`<namespace>:<slug>`). */
	existing: string;
	/** A short reason recorded with the disposition. */
	reason?: string;
	/** Advisory committer id for the commit subject. Defaults to git user.name. */
	by?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface AutoDispositionResult {
	/**
	 * Always `deleted`: BOTH no-question cases DISCHARGE the redundant note BY
	 * DELETION (`git rm` in a standalone commit, the reason in the message). A
	 * `duplicate` is a redundant copy of `existing`; a `map` is already covered by
	 * `existing` — either way the note carries no unique signal, so it leaves the
	 * inbox by being gone. There is no resting `triaged:keep` state any more (task
	 * `agentic-apply-retire-disposition-vocabulary`). NEVER an auto-delete of a
	 * NON-redundant signal.
	 */
	outcome: 'deleted';
	/** The commit sha the disposition produced. */
	commit: string;
	/** The path the note WAS at before it was deleted (the note is gone after this returns). */
	itemPath: string;
	/** A human-readable summary. */
	message: string;
}

/**
 * Execute a CONSERVATIVE auto-disposition on an UNTRIAGED observation (US #17),
 * ONE local commit, no question surfaced. BOTH no-question cases DISCHARGE the
 * redundant note BY DELETION (`git rm` in a STANDALONE commit, the mapped/
 * duplicated-of identity + reason in the commit message; git history = archive).
 * There is no resting `triaged:keep` state any more (task
 * `agentic-apply-retire-disposition-vocabulary` — a signal is still-open,
 * acted-on, or deleted):
 *
 *   - `duplicate` → the note is an EXACT duplicate of `existing` (already
 *     captured); the original carries the signal, so the copy is deleted; or
 *   - `map` → the note maps UNAMBIGUOUSLY onto `existing` (already covered there),
 *     so it is settled — deleted, the mapping recorded in the commit message
 *     (mirroring `duplicate`).
 *
 * It NEVER promotes (promotion is a human "worth building?" answer, the apply path)
 * and NEVER auto-deletes a NON-redundant signal (the gate's high bar bounds it to
 * `duplicate`/`map`, both of which carry no unique signal).
 */
export function autoDispositionObservation(
	options: AutoDispositionOptions,
): AutoDispositionResult {
	const {cwd, item, itemPath, kind, existing, env} = options;
	const note = options.note ?? (() => {});

	if (gitSoft(['rev-parse', '--git-dir'], cwd, env).status !== 0) {
		throw new TriagePersistError('not inside a git repository');
	}

	const reason = options.reason?.trim() ?? '';
	const by = options.by || resolveBy(cwd, env);

	// DISCHARGE BY DELETION (both cases): `git rm` the redundant note in a STANDALONE
	// commit (no spawned artifact), the relationship + reason in the commit message.
	// No body marker, no `triaged:` stamp — the note is out of the pool by being gone.
	gitHard(['rm', '--quiet', '--', itemPath], cwd, env);
	const relationship =
		kind === 'duplicate'
			? `an EXACT duplicate of ${existing} (already captured; the original carries the signal`
			: `mapped UNAMBIGUOUSLY onto ${existing} (already covered there; the existing item carries the signal`;
	const subject = `advance: triage ${item} → ${kind} (by ${by})`;
	const messageBody =
		`Discharged by deletion: ${relationship}, git history is the archive).` +
		(reason !== '' ? `\n\nreason: ${reason}` : '');
	gitHard(['commit', '--quiet', '-m', subject, '-m', messageBody], cwd, env);
	const commit = gitHard(['rev-parse', 'HEAD'], cwd, env).stdout.trim();
	const message =
		`auto-triaged ${item} → ${kind} of ${existing}: DELETED the note in a ` +
		'standalone commit (relationship + reason in the commit message, git history is the archive).';
	note(message);
	return {outcome: 'deleted', commit, itemPath, message};
}

// --- Promote → new-item creation through the CAS (US #24) -----------------

export interface PromoteObservationOptions {
	/** Working clone/worktree the promote runs in. */
	cwd: string;
	/** The namespaced observation identity (`observation:<slug>`). */
	item: string;
	/** The observation file path RELATIVE to `cwd` (e.g. `work/notes/observations/foo.md`). */
	itemPath: string;
	/**
	 * The artifact TYPE to mint, chosen by the AGENTIC apply VERDICT (task
	 * `agentic-apply-retire-disposition-vocabulary` — NOT a human `promote-*` field
	 * any more): `'task'` → `work/tasks/ready/<slug>.md` (the default); `'prd'` →
	 * `work/prds/proposed/<slug>.md` (a PRD-sized signal lands in `proposed/`
	 * staging, which a human later promotes to `ready/`). BOTH go through the SAME
	 * triage-local {@link createItemThroughCas} writer (one local commit through the
	 * CAS) — NOT intake's branch+integrate band — so the CAS-loser-backs-off
	 * guarantee and the same-commit note deletion are uniform across the two routes.
	 */
	artifact?: 'task' | 'prd';
	/**
	 * The NEW backlog slug to draft. Defaults to the observation's own slug (the
	 * promoted item is `work/backlog/<obs-slug>.md`). The CAS is keyed on the new
	 * item's PATH, so a same-slug new-item race ⇒ the loser fails the CAS.
	 */
	newSlug?: string;
	/**
	 * The new task's content. Defaults to a SELF-CONTAINED body built from the
	 * observation (its mechanism + fix prose carried into `## What to build`, its
	 * `## Open questions` transcribed, `needsAnswers` set when questions remain) —
	 * so the spawned task is buildable on its own and the note is safely deletable.
	 */
	stubContent?: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Advisory committer id for the commit subject. Defaults to git user.name. */
	by?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Show the intended CAS push without mutating the arbiter (`--dry-run`). */
	dryRun?: boolean;
	/**
	 * The CAS CONTENTION-RETRY BUDGET (jittered inter-retry delay + widened
	 * attempt / wall-clock envelope). Threaded through to
	 * {@link createItemThroughCas}. The lifecycle driver passes
	 * `LIFECYCLE_CAS_CONTENTION` here so a propose-tick FAN-OUT of parallel
	 * promote legs desynchronises and DRAINS instead of thrashing to `contended`.
	 * Absent ⇒ the interactive default (3 retries, no delay).
	 */
	contention?: CasContentionBudget;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface PromoteObservationResult {
	/**
	 * `promoted` (the new item landed via the CAS + the observation+sidecar were
	 * deleted in the SAME commit), `lost` (the same-slug new-item race was lost —
	 * the loser backs off, observation left INTACT), or `contended` (the CAS push
	 * kept failing). Maps onto the claim-CAS exit codes.
	 */
	outcome: 'promoted' | 'lost' | 'contended' | 'usage-error';
	exitCode: 0 | 1 | 2 | 3;
	/** The new task's path (relative to repo root) on a WIN. */
	newItemPath?: string;
	/** A human-readable summary. */
	message: string;
}

/**
 * Promote an ANSWERED observation to a NEW, SELF-CONTAINED artifact (US #1/#3/#8
 * for the task route; US #4/#9 for the PRD route): CAS-create the new item keyed
 * on the NEW item's identity (its target path), with the observation note + its
 * answered sidecar `git rm`-ed IN THE SAME atomic commit. Promote is ONE commit
 * (create + delete).
 *
 * The artifact TYPE (`options.artifact`) selects the target + body shape: `'task'`
 * (default) mints `work/tasks/ready/<slug>.md`; `'prd'` mints
 * `work/prds/proposed/<slug>.md` (PRD staging — a human later promotes it to
 * `ready/`). BOTH routes use the SAME triage-local {@link createItemThroughCas}
 * writer (NOT intake's `switchToWorkBranch`/`performIntegration` branch+integrate
 * band, which is intake's standalone front door): one create/integrate surface for
 * triage, the CAS-loser-backs-off guarantee uniform across task and PRD promotion.
 *
 * The minted body is built FROM the observation (see {@link buildPromotedBody}):
 * its mechanism + fix prose is carried into the artifact's lead section (`## What
 * to build` for a task, `## Problem Statement` for a PRD), and its
 * `## Open questions` scoping is transcribed into the new item's own
 * `## Open questions` block with `needsAnswers` set when questions remain (cleared
 * when none do) — so an agent can build from the artifact ALONE and no decision
 * residue is lost on deletion. This self-containment is the PRECONDITION for the
 * same-commit deletion.
 *
 * The CAS-create is the new-item-creation helper from `advancing-lock-borrow`
 * ({@link createItemThroughCas}): a same-slug new-item race needs NO special case
 * — exactly one creator lands the file, the LOSER fails the CAS (exit 2) and backs
 * off WITHOUT deleting the observation (so a retry can re-promote). The observation
 * (+ its sidecar) is deleted ONLY on a WIN, riding the winning creator's commit.
 */
export async function promoteObservation(
	options: PromoteObservationOptions,
): Promise<PromoteObservationResult> {
	const {cwd, item, itemPath, env} = options;
	const note = options.note ?? (() => {});

	const {slug: obsSlug} = resolveSidecarIdentity(item);
	const newSlug = (options.newSlug ?? obsSlug).trim();
	const artifact = options.artifact ?? 'task';
	if (newSlug === '') {
		return {
			outcome: 'usage-error',
			exitCode: 1,
			message: `promote ${item}: empty new slug — cannot draft a ${artifact}`,
		};
	}
	// Branch the target on artifact TYPE: `task` → the agent pool (`tasks-ready`);
	// `prd` → PRD STAGING (`prds-proposed`), the conservative default a human later
	// promotes to `ready/`. Both still go through the SAME createItemThroughCas
	// writer below — only the destination folder + body shape differ.
	const newItemPath = workItemRel(
		artifact === 'prd' ? 'prds-proposed' : 'tasks-ready',
		`${newSlug}.md`,
	);
	const by = options.by || resolveBy(cwd, env);
	const content = ensureTaskDispatchable(
		artifact,
		newSlug,
		options.stubContent ??
			buildPromotedBody(artifact, newSlug, readItem(cwd, itemPath, env)),
	);

	// The note + its answered sidecar `git rm` IN THE SAME create commit (promote =
	// ONE atomic commit). A CAS LOSER never reaches the commit, so it leaves both
	// INTACT for a retry (today's loser-backs-off guarantee, now over deletion).
	const sidecarPath = sidecarPathFor(item);

	// CAS-CREATE the new task keyed on its identity, carrying the note+sidecar
	// deletion in the SAME commit. A same-slug race ⇒ the loser fails here and
	// backs off WITHOUT deleting the observation.
	const created: CreateItemThroughCasResult = await createItemThroughCas({
		path: newItemPath,
		content,
		deletePaths: [itemPath, sidecarPath],
		cwd,
		arbiter: options.arbiter,
		by,
		dryRun: options.dryRun,
		env,
		note,
		...(options.contention !== undefined
			? {contention: options.contention}
			: {}),
	});
	if (created.exitCode !== 0) {
		const message =
			`promote ${item}: the new item ${newItemPath} ${created.outcome} the ` +
			`create CAS (${created.message}) — backing off, the observation is left ` +
			'intact for a retry.';
		note(message);
		return {
			outcome: created.outcome === 'lost' ? 'lost' : 'contended',
			exitCode: created.exitCode,
			message,
		};
	}

	const message =
		`promoted ${item} → CREATED ${newItemPath} (via the CAS) + DELETED the ` +
		'observation + its sidecar in the same commit.';
	note(message);
	return {outcome: 'promoted', exitCode: 0, newItemPath, message};
}

/**
 * Build a SELF-CONTAINED body from a promoted observation. The observation's body
 * (its mechanism + fix prose) is lifted into the artifact's LEAD section; its
 * `## Open questions` section — if any — is SPLIT OUT and transcribed into the new
 * item's own `## Open questions` block, and `needsAnswers: true` is stamped iff
 * that block carries content (so deleting the note loses no scoping residue).
 *
 * The artifact TYPE selects the frontmatter + lead heading: a `task` gets
 * `## What to build` + `blockedBy: []` + a `## Prompt` (the buildable-task shape);
 * a `prd` gets `## Problem Statement` (the PRD-spec shape, with no `blockedBy` —
 * a PRD is not a blockable task — and no `## Prompt`, since a PRD is not
 * dispatched by `do`/`run`). BOTH carry the SAME transcribed mechanism prose +
 * open-question block, so a PRD minted into `proposed/` is just as self-contained
 * as a task.
 *
 * The `## Prompt` (task only) is the STRUCTURAL dispatchability the validator
 * `resolveTask`/`extractPromptSection` (`prompt.ts`) requires: without it a
 * dispatched build throws "has no '## Prompt' section". The body BELOW the
 * frontmatter (lead section + mechanism prose + optional `## Open questions` +
 * the task-only `## Prompt`) is rendered by the SHARED owner of the
 * buildable-task/PRD schema, {@link renderTaskBody} / {@link renderPrdBody}
 * (`buildable-body.ts`), so the producer and the consumer cannot drift apart
 * (prd `centralize-buildable-task-renderer-shared-by-intake-and-promotion`,
 * US #3/#5/#6). This function owns only the FRONTMATTER writer; the section
 * skeleton lives in the one renderer. The empty-mechanism `## Prompt` seed is
 * passed EXPLICITLY (`Build the task '<slug>', described above.`) so promotion's
 * output is byte-for-byte unchanged — it differs from the renderer's generic
 * `Build the task described above.` default.
 *
 * Composition rule (recorded in the done record `## Decisions`): the split point
 * is the observation's FIRST `## Open questions` heading (any later sibling text
 * up to the next same-level heading, or EOF, is the scoping). Everything BEFORE it
 * is the mechanism/fix prose. We copy PROSE (not a back-pointer) so the artifact is
 * buildable on its own.
 */
/**
 * Guarantee a minted TASK body is DISPATCHABLE (carries a `## Prompt`). The
 * agentic apply path (`apply-decide` → `promoteObservation` with `stubContent`)
 * lets a fresh-context agent AUTHOR the task body, and that agent frequently omits
 * the `## Prompt` section (drafting its own `## Context`/`## Definition of done`
 * skeleton instead) — so the raw drafted body bypasses {@link buildPromotedBody}'s
 * renderer and lands NON-dispatchable: the `advance --propose` build leg then
 * fails with `has no '## Prompt' section` (the `extractPromptSection`/`resolveTask`
 * guard in `prompt.ts`). This is the robust backstop that closes that hole
 * regardless of agent compliance: for a TASK, if the body has no `## Prompt`
 * heading, append a seeded one (blockquoted, matching the renderer's shape). A PRD
 * is left UNTOUCHED — a PRD is a spec, not dispatched by `do`/`run`, and carries no
 * `## Prompt` by design.
 */
function ensureTaskDispatchable(
	artifact: 'task' | 'prd',
	slug: string,
	body: string,
): string {
	if (artifact === 'prd') {
		return body;
	}
	// A task WITH a `## Prompt` heading (any level-2 spelling the validator matches)
	// is already dispatchable — leave it byte-for-byte.
	if (/^##\s+Prompt\b/im.test(body)) {
		return body;
	}
	// No `## Prompt`: append a seeded, blockquoted one so the minted task never
	// lands non-dispatchable. The seed points the builder at the body above (the
	// same shape `renderTaskBody`'s empty-mechanism default uses).
	const trimmed = body.replace(/\s+$/, '');
	const seed = `Build the task '${slug}', described above.`;
	const promptBlock = `## Prompt\n\n> ${seed}\n`;
	return `${trimmed}\n\n${promptBlock}`;
}

function buildPromotedBody(
	artifact: 'task' | 'prd',
	slug: string,
	observation: string,
): string {
	const {mechanism, openQuestions} = splitObservationBody(observation);
	const hasQuestions = openQuestions.trim() !== '';
	const frontmatter: string[] = [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		`needsAnswers: ${hasQuestions ? 'true' : 'false'}`,
		// A PRD is a spec, not a blockable task — only the task shape carries
		// `blockedBy`.
		...(artifact === 'prd' ? [] : ['blockedBy: []']),
		'---',
	];
	// One BLANK line separates the closing frontmatter fence from the rendered
	// body (`---\n\n## ...`): the shared renderer starts AT its first heading with no
	// leading blank, so the separator is owned here. This keeps promotion's output
	// byte-for-byte identical to the pre-rewire hand-rolled body (which placed an
	// empty array element between the `---` fence and the lead heading) and matches
	// what intake will emit once it adopts the same renderer. RATIFIED as a
	// cross-module convention in `docs/adr/frontmatter-owns-fence-to-heading-blank-line.md`
	// — frontmatter owns the `\n\n`, the renderer starts at the first heading with
	// no leading blank. Do NOT move the separator into the renderer.
	const fenceToBody = frontmatter.join('\n') + '\n\n';
	// The body BELOW the frontmatter is rendered by the SHARED schema owner so the
	// section skeleton has one home, not two (prd
	// `centralize-buildable-task-renderer-shared-by-intake-and-promotion`). A PRD
	// goes through `renderPrdBody` (no `## Prompt`); a task through
	// `renderTaskBody` (always a `## Prompt`).
	if (artifact === 'prd') {
		return (
			fenceToBody +
			renderPrdBody({
				problemStatement: mechanism,
				openQuestions,
			})
		);
	}
	// Pass the slug-bearing empty-mechanism seed EXPLICITLY: the renderer's generic
	// default is `Build the task described above.`, but promotion has always seeded
	// the empty-mechanism case with the slug (`Build the task '<slug>', described
	// above.`), so we keep that byte-for-byte by handing the seed in rather than
	// relying on the renderer default. A non-empty mechanism seeds the `## Prompt`
	// from the mechanism prose (the renderer blockquotes it).
	const promptSeed =
		mechanism.trim() === ''
			? `Build the task '${slug}', described above.`
			: mechanism;
	return (
		fenceToBody +
		renderTaskBody({
			whatToBuild: mechanism,
			openQuestions,
			prompt: promptSeed,
		})
	);
}

/**
 * Split an observation's text into its mechanism/fix PROSE (before the first
 * `## Open questions` heading) and its open-questions SCOPING (that section's
 * body, up to the next `## ` heading or EOF). The frontmatter fence is dropped
 * (the new task gets its own). When there is no `## Open questions` heading the
 * whole body is mechanism and the scoping is empty.
 */
function splitObservationBody(observation: string): {
	mechanism: string;
	openQuestions: string;
} {
	const body = stripFrontmatter(observation);
	const lines = body.split('\n');
	// Match `## Open questions` (and tolerant variants like
	// `## Open questions to NOT guess` the capture-signal skill writes).
	const startIdx = lines.findIndex((l) => /^##\s+Open questions\b/i.test(l));
	if (startIdx === -1) {
		return {mechanism: body, openQuestions: ''};
	}
	let endIdx = lines.length;
	for (let i = startIdx + 1; i < lines.length; i++) {
		if (/^##\s+/.test(lines[i])) {
			endIdx = i;
			break;
		}
	}
	const mechanism = lines.slice(0, startIdx).join('\n');
	const openQuestions = lines.slice(startIdx + 1, endIdx).join('\n');
	return {mechanism, openQuestions};
}

/** Strip a leading `---\n…\n---` frontmatter fence, returning the body. */
function stripFrontmatter(content: string): string {
	const normalized = content.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
	if (!normalized.startsWith('---\n')) {
		return normalized;
	}
	const lines = normalized.split('\n');
	const closing = lines.indexOf('---', 1);
	if (closing === -1) {
		return normalized;
	}
	return lines
		.slice(closing + 1)
		.join('\n')
		.replace(/^\n+/, '');
}
