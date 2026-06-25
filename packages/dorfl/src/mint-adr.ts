import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {run, type RunResult} from './git.js';
import {
	createItemThroughCas,
	type CreateItemThroughCasResult,
} from './advancing-lock.js';
import {resolveSidecarIdentity, sidecarPathFor} from './sidecar.js';

/**
 * The **ADR-MINT route** (prd
 * `agentic-question-resolution-retire-disposition-vocabulary` US #2, task
 * `agentic-apply-mint-adr-route`) — the SIBLING of {@link
 * import('./triage-persist.js').promoteObservation}, for the agentic apply
 * `mint-adr` verdict.
 *
 * Why a SIBLING and not an `adr` artifact type on `promoteObservation`
 * (recorded `## Decisions`): `promoteObservation` is `work/`-folder-SHAPED — it
 * targets `work/tasks/ready` / `work/prds/proposed` via `workItemRel`, and builds
 * a task/prd body (a `## What to build` / `## Problem Statement` lead + an
 * `## Open questions` block, with `needsAnswers` carried). An ADR is DIFFERENT in
 * EVERY one of those: it lives in `docs/adr/` (OUTSIDE the work board, so the
 * `work/`-layout path builder does not fit), it carries NO `needsAnswers`/open-
 * questions block (an ADR records a SETTLED decision, the antithesis of an open
 * question), and its body is the ADR-FORMAT shape (a context/decision/why record).
 * Forking the body+target branch inside `promoteObservation` would make that
 * function mean two unrelated things; a sibling that REUSES the shared CAS-create
 * primitive (and nothing else) is the cleaner seam.
 *
 * It REUSES the keystone's guarantees verbatim, because both go through the SAME
 * {@link createItemThroughCas} primitive (the new-item-creation CAS from
 * `advancing-lock-borrow`): the source observation + its answered sidecar are
 * `git rm`-ed IN THE SAME atomic commit as the ADR create (delete-on-promote),
 * and a CAS LOSER — which never reaches the commit — backs off WITHOUT deleting
 * the source (left intact for a retry). The ONLY differences from
 * `promoteObservation` are the TARGET path (`docs/adr/<slug>.md`) and the BODY
 * shape (the ADR record).
 */

function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	return run('git', args, cwd, {env});
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
		throw new MintAdrError(
			`cannot read observation body for '${itemPath}' (the ADR-mint route needs the item file)`,
		);
	}
}

/** Raised for usage errors (an empty slug, an unreadable observation). */
export class MintAdrError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MintAdrError';
	}
}

/**
 * The repo-relative `docs/adr/` home for minted ADRs. ADRs live OUTSIDE the
 * `work/` governance tree (so they are NOT in `work-layout.ts`'s registry); this
 * is the single literal the route roots its target on. `docs/adr/` is created
 * lazily by {@link createItemThroughCas} (it `mkdir -p`s the target's dirname).
 */
export const ADR_DIR_REL = 'docs/adr';

/** The repo-relative path of a minted ADR file: `docs/adr/<slug>.md`. */
export function adrItemRel(slug: string): string {
	return `${ADR_DIR_REL}/${slug}.md`;
}

export interface MintAdrOptions {
	/** Working clone/worktree the mint runs in. */
	cwd: string;
	/** The namespaced source identity (`observation:<slug>`). */
	item: string;
	/** The source item file path RELATIVE to `cwd` (e.g. `work/notes/observations/foo.md`). */
	itemPath: string;
	/**
	 * The ADR slug to draft. Defaults to the source observation's own slug, so the
	 * minted ADR is `docs/adr/<obs-slug>.md`. The CAS is keyed on the new ADR's
	 * PATH, so a same-slug ADR race ⇒ the loser fails the CAS and backs off.
	 */
	adrSlug?: string;
	/**
	 * The ADR's short title (the `# {title}` heading line). Defaults to the slug
	 * when absent.
	 */
	adrTitle?: string;
	/**
	 * The ADR's content — the markdown AFTER the frontmatter (the
	 * context/decision/why record). When omitted, a SELF-CONTAINED body is built
	 * FROM the source observation + its answered question(s) (see
	 * {@link buildAdrBody}), so the decision's WHY is carried in and the source is
	 * safely deletable.
	 */
	adrBody?: string;
	/**
	 * The answered question(s) + answers the decision rests on, carried into the
	 * built body's Context/Decision when no explicit `adrBody` is supplied (so the
	 * minted ADR is self-contained even without an agent-drafted body).
	 */
	answers?: {question: string; answer: string}[];
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

export interface MintAdrResult {
	/**
	 * `minted` (the ADR landed via the CAS + the observation+sidecar were deleted
	 * in the SAME commit), `lost` (the same-slug ADR race was lost — the loser backs
	 * off, observation left INTACT), or `contended` (the CAS push kept failing).
	 * Maps onto the claim-CAS exit codes.
	 */
	outcome: 'minted' | 'lost' | 'contended' | 'usage-error';
	exitCode: 0 | 1 | 2 | 3;
	/** The new ADR's path (relative to repo root) on a WIN. */
	adrPath?: string;
	/** A human-readable summary. */
	message: string;
}

/**
 * Mint a NEW, SELF-CONTAINED ADR FROM an answered observation (the agentic apply
 * `mint-adr` verdict, US #2): CAS-create `docs/adr/<slug>.md` keyed on the new
 * ADR's identity (its path), with the source observation + its answered sidecar
 * `git rm`-ed IN THE SAME atomic commit. The mint is ONE commit (create + delete).
 *
 * The minted body is built FROM the source + the answered question(s) (see
 * {@link buildAdrBody}) so an engineer can read the decision's WHY from the ADR
 * ALONE — that self-containment is the PRECONDITION for the same-commit deletion
 * of the source. An agent-drafted `adrBody` (when present) is used verbatim.
 *
 * The CAS-create is the new-item-creation helper ({@link createItemThroughCas}):
 * a same-slug ADR race needs NO special case — exactly one creator lands the
 * file, the LOSER fails the CAS (exit 2) and backs off WITHOUT deleting the
 * source (so a retry can re-mint). The source (+ its sidecar) is deleted ONLY on a
 * WIN, riding the winning creator's commit.
 */
export async function mintAdr(options: MintAdrOptions): Promise<MintAdrResult> {
	const {cwd, item, itemPath, env} = options;
	const note = options.note ?? (() => {});

	const {slug: obsSlug} = resolveSidecarIdentity(item);
	const adrSlug = (options.adrSlug ?? obsSlug).trim();
	if (adrSlug === '') {
		return {
			outcome: 'usage-error',
			exitCode: 1,
			message: `mint-adr ${item}: empty ADR slug — cannot draft an ADR`,
		};
	}

	const adrPath = adrItemRel(adrSlug);
	const by = options.by || resolveBy(cwd, env);
	const title = (options.adrTitle ?? adrSlug).trim() || adrSlug;
	const content =
		options.adrBody !== undefined && options.adrBody.trim() !== ''
			? renderAdrFile(adrSlug, title, options.adrBody.trim())
			: buildAdrBody({
					slug: adrSlug,
					title,
					observation: readItem(cwd, itemPath, env),
					answers: options.answers ?? [],
				});

	// The source note + its answered sidecar `git rm` IN THE SAME create commit
	// (mint = ONE atomic commit). A CAS LOSER never reaches the commit, so it
	// leaves both INTACT for a retry (the loser-backs-off guarantee, over deletion).
	const sidecarPath = sidecarPathFor(item);

	const created: CreateItemThroughCasResult = await createItemThroughCas({
		path: adrPath,
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
			`mint-adr ${item}: the new ADR ${adrPath} ${created.outcome} the ` +
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
		`minted ${item} → CREATED ${adrPath} (via the CAS) + DELETED the ` +
		'observation + its sidecar in the same commit.';
	note(message);
	return {outcome: 'minted', exitCode: 0, adrPath, message};
}

/**
 * Build a SELF-CONTAINED ADR file FROM an answered observation + its answer(s),
 * in the repo's existing `docs/adr/` shape (recorded `## Decisions`): a `---`
 * frontmatter fence (`title` / `status: accepted` / `created`) then a
 * `# ADR: {title}` heading and the three ADR-FORMAT sections — **Context**
 * (the source signal that prompted the decision), **Decision** (what was decided,
 * from the human's answer), and **Why** (the rationale the answer carries). The
 * decision's WHY is carried IN (the answer prose), so the ADR reads alone — the
 * precondition for deleting the source in the same commit.
 *
 * The mechanism prose of the observation (everything before its first
 * `## Open questions` heading, frontmatter dropped) seeds Context; the
 * question(s)+answer(s) seed Decision + Why. When no answers are threaded the
 * Decision/Why fall back to the observation's prose so the file is never empty.
 */
export function buildAdrBody(input: {
	slug: string;
	title: string;
	observation: string;
	answers: {question: string; answer: string}[];
}): string {
	const context = mechanismOf(input.observation).trim();
	const decisionLines: string[] = [];
	const whyLines: string[] = [];
	for (const {question, answer} of input.answers) {
		const q = question.trim();
		const a = answer.trim();
		if (q !== '' || a !== '') {
			decisionLines.push(`- **${q || '(question)'}** — ${a || '(no answer)'}`);
			if (a !== '') {
				whyLines.push(a);
			}
		}
	}
	const body: string[] = [
		'## Context',
		'',
		context === ''
			? '(no source context was carried from the observation.)'
			: context,
		'',
		'## Decision',
		'',
		decisionLines.length > 0
			? decisionLines.join('\n')
			: '(the decision is recorded in the source context above.)',
		'',
		'## Why',
		'',
		whyLines.length > 0
			? whyLines.join('\n\n')
			: 'The decision follows directly from the answered question(s) above; the source signal is preserved in this ADR (the note itself leaves by deletion, git history is the archive).',
		'',
	];
	return renderAdrFile(input.slug, input.title, body.join('\n'));
}

/**
 * Wrap an ADR `body` (the markdown AFTER the frontmatter) in the repo's existing
 * ADR file shape: a `---` frontmatter fence (`title` / `status: accepted` /
 * `created`) then a `# ADR: {title}` heading, then the body. Mirrors the existing
 * `docs/adr/*.md` convention (slug-named files with a frontmatter block), NOT the
 * `NNNN-` numeric prefix the ADR-FORMAT template shows — the repo's LIVE
 * convention wins (recorded `## Decisions`).
 */
function renderAdrFile(slug: string, title: string, body: string): string {
	const date = new Date().toISOString().slice(0, 10);
	return [
		'---',
		`title: ${title}`,
		'status: accepted',
		`created: ${date}`,
		'---',
		'',
		`# ADR: ${title}`,
		'',
		body.replace(/\s*$/, ''),
		'',
	].join('\n');
}

/**
 * The observation's mechanism PROSE: everything before its first
 * `## Open questions` heading, with the frontmatter fence dropped. An ADR records
 * a SETTLED decision, so an observation's open-questions scoping is deliberately
 * NOT carried into the ADR body (unlike a promoted task/prd, which keeps the
 * open questions live) — the answered question(s) ARE the decision.
 */
function mechanismOf(observation: string): string {
	const body = stripFrontmatter(observation);
	const lines = body.split('\n');
	const startIdx = lines.findIndex((l) => /^##\s+Open questions\b/i.test(l));
	if (startIdx === -1) {
		return body;
	}
	return lines.slice(0, startIdx).join('\n');
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
