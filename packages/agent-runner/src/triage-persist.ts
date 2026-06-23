import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {run, type RunResult} from './git.js';
import {setFrontmatterMarker} from './frontmatter.js';
import {applyAtomic} from './sidecar-apply.js';
import {workItemRel} from './work-layout.js';
import {
	createItemThroughCas,
	type CreateItemThroughCasResult,
} from './advancing-lock.js';
import {
	parseSidecar,
	resolveSidecarIdentity,
	sidecarPathFor,
	type SidecarModel,
} from './sidecar.js';
import type {TriageAutoKind} from './triage-gate.js';

/**
 * The engine-owned TRIAGE PERSIST (brief `advance-loop`, task `advance-rung-triage`,
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
 *        - `duplicate` → APPEND a delete RECOMMENDATION (the human deletes per the
 *          capture-bucket contract; the agent NEVER auto-deletes a signal) + stamp
 *          `triaged:duplicate` so it drops out of the pool; or
 *        - `map` → record the mapping onto the existing item + stamp `triaged:keep`
 *          (settled onto its existing home, drops out of the pool, never re-asked).
 *   2. **promote → new-item creation through the CAS** ({@link promoteObservation},
 *      US #24): an ANSWERED "promote" drafts a new `work/backlog/<new-slug>.md`
 *      routed THROUGH the CAS keyed on the NEW item's identity (its target path),
 *      so the (unlikely) same-slug new-item race needs NO special case — the loser
 *      fails the CAS and backs off. On a WIN it then records the triage on the
 *      observation and RESOLVES it (clears `needsAnswers` + deletes the sidecar)
 *      atomically.
 *
 * Like its sibling persists, the auto-disposition + the post-create resolve are
 * LOCAL one-commit primitives over a working tree (the throwaway-git-repo test
 * pattern); the CAS-create is the ONLY arbiter race (it IS the new-item-creation
 * CAS helper from `advancing-lock-borrow`). The `advancing` CAS lock that makes the
 * triage rung WINNER-ONLY on the OBSERVATION is held by `performAdvance` BEFORE
 * this is called.
 *
 * **NEVER auto-deletes a non-duplicate signal; NEVER auto-promotes a judgement
 * call (US #17).** The auto-disposition is bounded to `duplicate`/`map` (the gate's
 * high bar), and `duplicate` only RECOMMENDS deletion. Promotion is ALWAYS a human
 * answer (the apply path), never an auto-disposition.
 */

/** The marker a conservative auto-disposition stamps so the observation drops out of the pool. */
const TRIAGED_DUPLICATE = 'duplicate';
const TRIAGED_KEEP = 'keep';

/** Marker headings appended to the observation body (durable, tooling-owned record). */
const DUPLICATE_HEADING = '## Recommended: delete (duplicate)';
const MAP_HEADING = '## Triaged: maps onto an existing item';
const PROMOTE_HEADING = '## Triaged: promoted';

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
	 * `delete-recommended` (a `duplicate` case — the human deletes) or `kept` (a
	 * `map` case — `triaged:keep`, drops out of the pool). NEVER an auto-delete.
	 */
	outcome: 'delete-recommended' | 'kept';
	/** The commit sha the disposition produced. */
	commit: string;
	/** The observation path (relative to `cwd`) — UNCHANGED (no lifecycle move). */
	itemPath: string;
	/** A human-readable summary. */
	message: string;
}

/**
 * Execute a CONSERVATIVE auto-disposition on an UNTRIAGED observation (US #17),
 * ONE local commit, no question surfaced. ONLY the two no-question cases:
 *
 *   - `duplicate` → append a delete RECOMMENDATION naming the existing duplicate +
 *     stamp `triaged:duplicate` (the human deletes — the agent never auto-deletes a
 *     signal); or
 *   - `map` → record the mapping onto the existing item + stamp `triaged:keep` (the
 *     observation is settled onto its existing home; it drops out of the pool).
 *
 * It NEVER promotes (promotion is a human "worth building?" answer, the apply path)
 * and NEVER auto-deletes a non-duplicate. The observation NEVER moves folders (no
 * lifecycle transition — the marker + the recommendation are the disposition).
 */
export function autoDispositionObservation(
	options: AutoDispositionOptions,
): AutoDispositionResult {
	const {cwd, item, itemPath, kind, existing, env} = options;
	const note = options.note ?? (() => {});

	if (gitSoft(['rev-parse', '--git-dir'], cwd, env).status !== 0) {
		throw new TriagePersistError('not inside a git repository');
	}

	const body = readItem(cwd, itemPath, env);
	const reason = options.reason?.trim() ?? '';
	const by = options.by || resolveBy(cwd, env);

	let marked: string;
	let outcome: AutoDispositionResult['outcome'];
	let message: string;
	if (kind === 'duplicate') {
		marked = setFrontmatterMarker(
			appendBlock(body, DUPLICATE_HEADING, [
				`This observation is an EXACT duplicate of \`${existing}\` (already`,
				'captured). RECOMMENDED: a human deletes this file (git history is the',
				'archive). The agent leaves the deletion to the human per the',
				'capture-bucket contract — it never auto-deletes a signal.',
				...(reason !== '' ? ['', `Reason: ${reason}`] : []),
			]),
			'triaged',
			TRIAGED_DUPLICATE,
		);
		outcome = 'delete-recommended';
		message =
			`auto-triaged ${item} → duplicate of ${existing}: RECOMMENDED deletion ` +
			`(triaged:duplicate; a human deletes the file, never the agent).`;
	} else {
		marked = setFrontmatterMarker(
			appendBlock(body, MAP_HEADING, [
				`This observation maps UNAMBIGUOUSLY onto \`${existing}\` (already`,
				'covered there), so it is settled — marked triaged:keep and dropped out',
				'of the candidate pool (never re-asked).',
				...(reason !== '' ? ['', `Reason: ${reason}`] : []),
			]),
			'triaged',
			TRIAGED_KEEP,
		);
		outcome = 'kept';
		message =
			`auto-triaged ${item} → maps onto ${existing} (triaged:keep; drops out of ` +
			'the pool, never re-asked).';
	}

	writeFileSync(join(cwd, itemPath), marked);
	gitHard(['add', '--', itemPath], cwd, env);
	gitHard(
		['commit', '--quiet', '-m', `advance: triage ${item} → ${kind} (by ${by})`],
		cwd,
		env,
	);
	const commit = gitHard(['rev-parse', 'HEAD'], cwd, env).stdout.trim();
	note(message);
	return {outcome, commit, itemPath, message};
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
	/** The new backlog stub's content. Defaults to a minimal stub from the observation. */
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
	 * `promoted` (the new item landed via the CAS + the observation was resolved),
	 * `lost` (the same-slug new-item race was lost — the loser backs off), or
	 * `contended` (the CAS push kept failing). Maps onto the claim-CAS exit codes.
	 */
	outcome: 'promoted' | 'lost' | 'contended' | 'usage-error';
	exitCode: 0 | 1 | 2 | 3;
	/** The new backlog item's path (relative to repo root) on a WIN. */
	newItemPath?: string;
	/** A human-readable summary. */
	message: string;
}

/**
 * Promote an ANSWERED observation to a NEW backlog stub (US #24): CAS-create the
 * new `work/backlog/<new-slug>.md` keyed on the NEW item's identity (its target
 * path), then — on a WIN — record the triage on the observation and RESOLVE it
 * (clear `needsAnswers` + delete the sidecar) atomically.
 *
 * The CAS-create is the new-item-creation helper from `advancing-lock-borrow`
 * ({@link createItemThroughCas}): a same-slug new-item race needs NO special case
 * — exactly one creator lands the file, the LOSER fails the CAS (exit 2) and backs
 * off WITHOUT resolving the observation (so a retry can re-promote with a different
 * slug). The promotion is a NEW item's creation, NOT a move of the observation
 * (the observation stays in `work/observations/`, resolved + recorded).
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
			message: `promote ${item}: empty new slug — cannot draft a backlog stub`,
		};
	}
	const newItemPath = workItemRel('tasks-todo', `${newSlug}.md`);
	const by = options.by || resolveBy(cwd, env);
	const content = options.stubContent ?? defaultStub(newSlug, item);

	// 1. CAS-CREATE the new backlog stub keyed on its identity. A same-slug race ⇒
	//    the loser fails here and backs off WITHOUT resolving the observation.
	const created: CreateItemThroughCasResult = await createItemThroughCas({
		path: newItemPath,
		content,
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
			'unresolved for a retry.';
		note(message);
		return {
			outcome: created.outcome === 'lost' ? 'lost' : 'contended',
			exitCode: created.exitCode,
			message,
		};
	}

	// 2. WON: record the triage on the observation + RESOLVE it (clear needsAnswers
	//    + delete the sidecar) atomically. The observation stays in observations/.
	const body = readItem(cwd, itemPath, env);
	const recorded = appendBlock(body, PROMOTE_HEADING, [
		`Promoted to a new backlog task \`${newItemPath}\` (a human answered`,
		'"promote"). This observation is resolved; the new item carries the work.',
	]);
	const sidecar = readSidecar(cwd, item);
	applyAtomic({
		cwd,
		itemPath,
		itemBody: recorded,
		sidecar,
		mode: 'resolve',
		by,
		env,
		note,
	});

	const message =
		`promoted ${item} → CREATED ${newItemPath} (via the CAS) + resolved the ` +
		'observation (needsAnswers cleared, sidecar deleted).';
	note(message);
	return {outcome: 'promoted', exitCode: 0, newItemPath, message};
}

/** Read + parse the observation's answered sidecar (the apply path's source). */
function readSidecar(cwd: string, item: string): SidecarModel {
	const path = sidecarPathFor(item);
	const abs = join(cwd, path);
	if (!existsSync(abs)) {
		throw new TriagePersistError(
			`no sidecar at ${path} for ${item} — the promote path resolves an answered observation`,
		);
	}
	return parseSidecar(readFileSync(abs, 'utf8'));
}

/** A minimal backlog stub drafted from a promoted observation. */
function defaultStub(slug: string, fromObservation: string): string {
	return [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		'needsAnswers: true',
		'blockedBy: []',
		'---',
		'',
		'## What to build',
		'',
		`Promoted from observation \`${fromObservation}\`. A human answered`,
		'"promote": draft this into a buildable task. Carries `needsAnswers:true`',
		'so the advance loop surfaces the open scoping questions before it is built.',
		'',
	].join('\n');
}

/** Append a `## heading` block to a body (append-only; the body is the durable record). */
function appendBlock(body: string, heading: string, lines: string[]): string {
	const base = body.replace(/\s*$/, '');
	return [base, '', heading, '', ...lines, ''].join('\n');
}

// Re-export the heading + marker constants the tests assert against.
export {DUPLICATE_HEADING, MAP_HEADING, PROMOTE_HEADING};
