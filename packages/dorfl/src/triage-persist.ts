import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {run, type RunResult} from './git.js';
import {setFrontmatterMarker} from './frontmatter.js';
import {workItemRel} from './work-layout.js';
import {
	createItemThroughCas,
	type CreateItemThroughCasResult,
} from './advancing-lock.js';
import {resolveSidecarIdentity, sidecarPathFor} from './sidecar.js';
import type {TriageAutoKind} from './triage-gate.js';

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
 *      US #17, `observationTriage: 'auto'`-gated): record the no-question disposition on the
 *      UNTRIAGED observation in ONE local commit —
 *        - `duplicate` → DISCHARGE the note BY DELETION (`git rm` the duplicate in a
 *          standalone commit, the duplicated-of identity + reason in the commit
 *          message; git history = archive). A duplicate is a redundant copy of an
 *          already-captured signal, so deleting it loses nothing — it leaves the
 *          inbox by being gone, with no `## Recommended: delete` marker and no
 *          `triaged:` stamp; or
 *        - `map` → record the mapping onto the existing item + stamp `triaged:keep`
 *          (settled onto its existing home, drops out of the pool, never re-asked).
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

/** The marker the `map` auto-disposition stamps so the observation drops out of the pool. */
const TRIAGED_KEEP = 'keep';

/** Marker heading appended to the observation body on the `map` disposition (durable record). */
const MAP_HEADING = '## Triaged: maps onto an existing item';

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
	/** The observation file path RELATIVE to `cwd` (e.g. `work/observations/foo.md`). */
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
	 * `deleted` (a `duplicate` case — the redundant note is `git rm`-ed in a
	 * standalone commit, the reason in the message) or `kept` (a `map` case —
	 * `triaged:keep`, drops out of the pool). NEVER an auto-delete of a
	 * NON-duplicate signal.
	 */
	outcome: 'deleted' | 'kept';
	/** The commit sha the disposition produced. */
	commit: string;
	/**
	 * The observation path (relative to `cwd`). For `map` it is UNCHANGED (no
	 * lifecycle move). For `duplicate` it is the path the note WAS at before it was
	 * deleted (the note is gone after this returns).
	 */
	itemPath: string;
	/** A human-readable summary. */
	message: string;
}

/**
 * Execute a CONSERVATIVE auto-disposition on an UNTRIAGED observation (US #17),
 * ONE local commit, no question surfaced. ONLY the two no-question cases:
 *
 *   - `duplicate` → DISCHARGE the redundant note BY DELETION: `git rm` it in a
 *     standalone commit, the duplicated-of identity + reason in the commit
 *     message (git history = archive). It leaves the inbox by being gone — no
 *     `## Recommended: delete` marker, no `triaged:` stamp; or
 *   - `map` → record the mapping onto the existing item + stamp `triaged:keep` (the
 *     observation is settled onto its existing home; it drops out of the pool).
 *
 * It NEVER promotes (promotion is a human "worth building?" answer, the apply path)
 * and NEVER auto-deletes a NON-duplicate signal. A `map` NEVER moves folders (the
 * marker IS the disposition); a `duplicate` removes the note entirely (it is a
 * redundant copy — the original carries the signal, so nothing is lost).
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

	if (kind === 'duplicate') {
		// DISCHARGE BY DELETION: a duplicate is a redundant copy of `existing`, so
		// `git rm` it in a STANDALONE commit (no spawned artifact for a duplicate),
		// the duplicated-of identity + reason in the commit message. No body marker,
		// no `triaged:` stamp — the note is out of the pool by being gone.
		gitHard(['rm', '--quiet', '--', itemPath], cwd, env);
		const subject = `advance: triage ${item} → duplicate (by ${by})`;
		const messageBody =
			`Discharged by deletion: an EXACT duplicate of ${existing} (already ` +
			`captured; the original carries the signal, git history is the archive).` +
			(reason !== '' ? `\n\nreason: ${reason}` : '');
		gitHard(['commit', '--quiet', '-m', subject, '-m', messageBody], cwd, env);
		const commit = gitHard(['rev-parse', 'HEAD'], cwd, env).stdout.trim();
		const message =
			`auto-triaged ${item} → duplicate of ${existing}: DELETED the note in a ` +
			'standalone commit (reason in the commit message, git history is the archive).';
		note(message);
		return {outcome: 'deleted', commit, itemPath, message};
	}

	const body = readItem(cwd, itemPath, env);
	const marked = setFrontmatterMarker(
		appendBlock(body, MAP_HEADING, [
			`This observation maps UNAMBIGUOUSLY onto \`${existing}\` (already`,
			'covered there), so it is settled — marked triaged:keep and dropped out',
			'of the candidate pool (never re-asked).',
			...(reason !== '' ? ['', `Reason: ${reason}`] : []),
		]),
		'triaged',
		TRIAGED_KEEP,
	);
	const message =
		`auto-triaged ${item} → maps onto ${existing} (triaged:keep; drops out of ` +
		'the pool, never re-asked).';

	writeFileSync(join(cwd, itemPath), marked);
	gitHard(['add', '--', itemPath], cwd, env);
	gitHard(
		['commit', '--quiet', '-m', `advance: triage ${item} → ${kind} (by ${by})`],
		cwd,
		env,
	);
	const commit = gitHard(['rev-parse', 'HEAD'], cwd, env).stdout.trim();
	note(message);
	return {outcome: 'kept', commit, itemPath, message};
}

// --- Promote → new-item creation through the CAS (US #24) -----------------

export interface PromoteObservationOptions {
	/** Working clone/worktree the promote runs in. */
	cwd: string;
	/** The namespaced observation identity (`observation:<slug>`). */
	item: string;
	/** The observation file path RELATIVE to `cwd` (e.g. `work/observations/foo.md`). */
	itemPath: string;
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
 * Promote an ANSWERED observation to a NEW, SELF-CONTAINED task (US #1/#3/#8):
 * CAS-create the new `work/tasks/ready/<new-slug>.md` keyed on the NEW item's
 * identity (its target path), with the observation note + its answered sidecar
 * `git rm`-ed IN THE SAME atomic commit. Promote is ONE commit (create + delete).
 *
 * The minted task body is built FROM the observation (see {@link buildPromotedBody}):
 * its mechanism + fix prose is carried into `## What to build`, and its
 * `## Open questions` scoping is transcribed into the task's own `## Open questions`
 * block with `needsAnswers` set when questions remain (cleared when none do) — so an
 * agent can build from the task ALONE and no decision residue is lost on deletion.
 * This self-containment is the PRECONDITION for the same-commit deletion.
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
	if (newSlug === '') {
		return {
			outcome: 'usage-error',
			exitCode: 1,
			message: `promote ${item}: empty new slug — cannot draft a task`,
		};
	}
	const newItemPath = workItemRel('tasks-ready', `${newSlug}.md`);
	const by = options.by || resolveBy(cwd, env);
	const content =
		options.stubContent ??
		buildPromotedBody(newSlug, readItem(cwd, itemPath, env));

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
 * Build a SELF-CONTAINED task body from a promoted observation. The observation's
 * body (its mechanism + fix prose) is lifted into `## What to build`; its
 * `## Open questions` section — if any — is SPLIT OUT and transcribed into the
 * task's own `## Open questions` block, and `needsAnswers: true` is stamped iff
 * that block carries content (so deleting the note loses no scoping residue).
 *
 * Composition rule (recorded in the done record `## Decisions`): the split point
 * is the observation's FIRST `## Open questions` heading (any later sibling text
 * up to the next same-level heading, or EOF, is the scoping). Everything BEFORE it
 * is the mechanism/fix prose. We copy PROSE (not a back-pointer) so the task is
 * buildable on its own.
 */
function buildPromotedBody(slug: string, observation: string): string {
	const {mechanism, openQuestions} = splitObservationBody(observation);
	const hasQuestions = openQuestions.trim() !== '';
	const lines: string[] = [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		`needsAnswers: ${hasQuestions ? 'true' : 'false'}`,
		'blockedBy: []',
		'---',
		'',
		'## What to build',
		'',
		mechanism.trim() === ''
			? '(no mechanism/fix prose was carried from the observation.)'
			: mechanism.trim(),
		'',
	];
	if (hasQuestions) {
		lines.push('## Open questions', '', openQuestions.trim(), '');
	}
	return lines.join('\n');
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

/** Append a `## heading` block to a body (append-only; the body is the durable record). */
function appendBlock(body: string, heading: string, lines: string[]): string {
	const base = body.replace(/\s*$/, '');
	return [base, '', heading, '', ...lines, ''].join('\n');
}

// Re-export the heading constant the tests assert against.
export {MAP_HEADING};
