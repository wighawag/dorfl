import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {run} from './git.js';
import {ledgerRead} from './ledger-read.js';

/**
 * The folder-native **needs-attention mechanism** (ADR §12; WORK-CONTRACT
 * `needs-attention/` section). Every "couldn't finish, a human must look"
 * outcome — a failed acceptance gate (red `verify`), a rebase/merge conflict
 * (ADR §10), a slice the agent reported too ambiguous to build, a timeout, or a
 * rejected review — resolves to ONE move: the RUNNER `git mv`s the claimed item
 * from `work/in-progress/<slug>.md` to `work/needs-attention/<slug>.md`, writing
 * the reason (+ any agent-surfaced questions) into the file BODY, and commits it
 * exactly like the done-move.
 *
 * This is the conflict-safe form of "surfacing": the surface is a folder you can
 * `ls`, read by `scan`/`status` — there is **no status/label field** (honours
 * WORK-CONTRACT rule 3: status = the folder). The reason is prose in the body,
 * never a source-of-truth frontmatter field.
 *
 * Ownership: this module OWNS the mechanism (the move helper + the surface
 * reader + the return path). Consumers (`complete.ts`'s gate-failed/rebase-
 * conflict abort paths, the runner's stuck routing in `run.ts`, the human
 * `return` command) drive these through the ledger write seam's NEEDS-ATTENTION
 * transition (`ledgerWrite.applyNeedsAttentionTransition` /
 * `applyReturnToBacklogTransition` in `ledger-write.ts`), whose sole strategy
 * delegates to `routeToNeedsAttention` / `returnToBacklog` here UNCHANGED — so
 * the later cherry-pick-to-`main` surfacing is built AGAINST the seam, not
 * bolted onto this move code. The build agent NEVER does this — agents do no git
 * (ADR §12).
 */

/** Marker that opens the appended reason block in a needs-attention item body. */
const REASON_HEADING = '## Needs attention';

export interface RouteToNeedsAttentionOptions {
	/** The working clone / job worktree the `work/<slug>` branch lives in. */
	cwd: string;
	/** The slug of the in-progress item to bounce. */
	slug: string;
	/** Why the item is stuck (red gate, rebase conflict, ambiguity, timeout, …). */
	reason: string;
	/** Any questions the agent surfaced for the human, recorded under the reason. */
	questions?: string[];
	/**
	 * The arbiter remote to push the transition to (like the done-move). When
	 * omitted, the move is committed locally only (the caller pushes the branch as
	 * part of its own flow, e.g. the runner's integration step).
	 */
	arbiter?: string;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface RouteToNeedsAttentionResult {
	/** True iff the item was moved + committed. */
	moved: boolean;
	/** When `moved`, the committed transition message (of the MOVE-ONLY commit). */
	commitMessage?: string;
	/**
	 * When `moved`, the sha of the **move-only** commit — the tip of `work/<slug>`
	 * that carries PURELY the `git mv → needs-attention/` + the reason (the wip
	 * commit holding the aborted agent work sits BELOW it). A surfacing strategy
	 * cherry-picks THIS commit to make the stuck state observable, so the wip never
	 * reaches the ledger.
	 */
	moveCommit?: string;
	/** When NOT moved, why (e.g. the slug was not in-progress). */
	reasonNotMoved?: string;
}

export interface ReturnToBacklogOptions {
	/** The working clone the `work/` tree lives in. */
	cwd: string;
	/** The slug of the needs-attention item to re-queue. */
	slug: string;
	/** The arbiter remote to push the transition to. Optional (see above). */
	arbiter?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ReturnToBacklogResult {
	/** True iff the item was moved back + committed. */
	moved: boolean;
	/** When `moved`, the committed transition message. */
	commitMessage?: string;
	/** When NOT moved, why (e.g. the slug was not in needs-attention). */
	reasonNotMoved?: string;
}

export interface ResolveFromNeedsAttentionOptions {
	/** The working clone the `work/` tree lives in. */
	cwd: string;
	/** The slug of the needs-attention item to resolve back to in-progress. */
	slug: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ResolveFromNeedsAttentionResult {
	/** True iff the item was moved back to in-progress + committed. */
	moved: boolean;
	/** When `moved`, the committed transition message. */
	commitMessage?: string;
	/** When `moved`, the sha of the reverse move-only commit (the new tip). */
	moveCommit?: string;
	/** When NOT moved, why (e.g. the slug was not in needs-attention). */
	reasonNotMoved?: string;
}

/** The folder a pre-needs-attention item could currently live in. */
function findSourceFolder(
	cwd: string,
	slug: string,
): {rel: string; abs: string} | undefined {
	for (const folder of ['in-progress', 'done']) {
		const rel = join('work', folder, `${slug}.md`);
		const abs = join(cwd, rel);
		if (existsSync(abs)) {
			return {rel, abs};
		}
	}
	return undefined;
}

/** One needs-attention item as the surface (`status`) reads it. */
export interface NeedsAttentionItem {
	/** Filename within `work/needs-attention/` (e.g. `alpha.md`). */
	file: string;
	/** Resolved slug (frontmatter `slug:`, falling back to the filename). */
	slug: string;
	/**
	 * The recorded reason prose (the text under the `## Needs attention` heading),
	 * when present — surfaced by `status`. Empty string when no reason block was
	 * written (e.g. an item moved here by hand).
	 */
	reason: string;
}

/**
 * Route a stuck claimed item to `needs-attention/` (ADR §12). The RUNNER calls
 * this; the build agent never does. It always **saves the aborted work** and
 * produces TWO commits on `work/<slug>` (never-lose-work; PRD
 * `needs-attention-cherry-pick`):
 *
 *   1. A **wip** commit holding the aborted agent work (`git add -A` of whatever
 *      the agent left uncommitted in the tree). This is committed FIRST and
 *      stays BELOW the tip, so a surfacing strategy that publishes only the tip
 *      never leaks the half-finished work onto the ledger. When the tree is
 *      already clean (nothing uncommitted) no wip commit is made — there is no
 *      aborted work to save.
 *   2. A **move-only** commit on top (the tip): the reason appended to the file
 *      BODY (prose, NOT a frontmatter field — WORK-CONTRACT rule 3) +
 *      `git mv work/<src>/<slug>.md work/needs-attention/<slug>.md` (mkdir -p the
 *      destination first — git tracks no empty dirs). The source is whichever of
 *      `in-progress/` (the test-gate path, before the done-move) or `done/` (the
 *      rebase-conflict path, after it) the item currently sits in. This commit is
 *      PURELY the move + reason — it is the one a surfacing strategy cherry-picks.
 *
 * Optionally pushes the work branch to the arbiter (when `arbiter` given) so the
 * saved wip + the move travel cross-machine.
 *
 * NEVER throws for the expected "not in-progress/done" case — it returns
 * `{moved: false, reasonNotMoved}` so consumers can branch cleanly. Genuine git
 * plumbing failures still throw (they are unexpected).
 */
export function routeToNeedsAttention(
	options: RouteToNeedsAttentionOptions,
): RouteToNeedsAttentionResult {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	// The item could be either in-progress (test-gate path, before the done-move)
	// or already moved to done/ (rebase-conflict path, after it). Bounce from
	// whichever folder holds it.
	const source = findSourceFolder(cwd, slug);
	if (!source) {
		return {
			moved: false,
			reasonNotMoved:
				`work/in-progress/${slug}.md (nor work/done/${slug}.md) found — ` +
				'nothing to route to needs-attention (wrong slug, or not in-progress?).',
		};
	}

	// 1. WIP commit: save whatever the agent left uncommitted FIRST, so it sits
	//    BELOW the move-only tip and a tip-only surface never carries it. Skip when
	//    the tree is clean (no aborted work to save).
	gitHard(['add', '-A'], cwd, env);
	if (!nothingStaged(cwd, env)) {
		gitHard(
			['commit', '-q', '-m', `chore(${slug}): save aborted work (wip)`],
			cwd,
			env,
		);
	}

	// 2. Record the reason as PROSE in the body (never a frontmatter field), then
	//    move folders (mkdir -p first; git tracks no empty dirs — no .gitkeep), and
	//    commit the MOVE-ONLY transition (reason + the git mv, nothing else) as the
	//    tip. This is the commit a surfacing strategy cherry-picks.
	appendReasonBlock(source.abs, options.reason, options.questions);
	const destDir = join(cwd, 'work', 'needs-attention');
	mkdirSync(destDir, {recursive: true});
	const destRel = join('work', 'needs-attention', `${slug}.md`);
	gitHard(['mv', source.rel, destRel], cwd, env);
	gitHard(['add', '-A'], cwd, env);
	const commitMessage = `chore(${slug}): route to needs-attention; ${options.reason}`;
	gitHard(['commit', '-q', '-m', commitMessage], cwd, env);
	const moveCommit = revParseHead(cwd, env);
	note(`Routed '${slug}' to needs-attention: ${options.reason}`);

	// Optionally push the branch (the done-move pushes; the runner's flow may
	//    instead push as part of integration — so this is opt-in).
	if (options.arbiter) {
		const branch = `work/${slug}`;
		gitHard(['push', options.arbiter, `${branch}:${branch}`], cwd, env);
	}

	return {moved: true, commitMessage, moveCommit};
}

/**
 * The clean re-queue (ADR §12 / WORK-CONTRACT return path): once the human has
 * resolved the cause, `git mv work/needs-attention/<slug>.md
 * work/backlog/<slug>.md` and commit it so the item can be re-claimed (it must
 * not rot in needs-attention). The recorded reason block stays in the body as a
 * durable note of what happened; the resolution itself is the human's.
 *
 * Like the move, NEVER throws for the expected "not in needs-attention" case.
 */
export function returnToBacklog(
	options: ReturnToBacklogOptions,
): ReturnToBacklogResult {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	const naRel = join('work', 'needs-attention', `${slug}.md`);
	const naAbs = join(cwd, naRel);
	if (!existsSync(naAbs)) {
		return {
			moved: false,
			reasonNotMoved:
				`work/needs-attention/${slug}.md not found — nothing to return to ` +
				'backlog (wrong slug, or not in needs-attention?).',
		};
	}

	const destDir = join(cwd, 'work', 'backlog');
	mkdirSync(destDir, {recursive: true});
	const destRel = join('work', 'backlog', `${slug}.md`);
	gitHard(['mv', naRel, destRel], cwd, env);

	gitHard(['add', '-A'], cwd, env);
	const commitMessage = `chore(${slug}): return to backlog for re-claiming`;
	gitHard(['commit', '-q', '-m', commitMessage], cwd, env);
	note(`Returned '${slug}' to backlog.`);

	if (options.arbiter) {
		gitHard(['push', options.arbiter, 'HEAD'], cwd, env);
	}

	return {moved: true, commitMessage};
}

/**
 * Resolve a stuck item back to `in-progress/` (the reverse of the
 * needs-attention move) so a human can pick it up again. The clean-up half of
 * the surfacing design (PRD `needs-attention-cherry-pick`): once a human starts
 * a stuck slice, the needs-attention surface must be CLEARED and the item
 * restored to in-progress. It `git mv work/needs-attention/<slug>.md →
 * work/in-progress/<slug>.md` and commits the MOVE-ONLY transition (the recorded
 * reason stays in the body as a durable note). Returns the move commit sha so a
 * surfacing strategy can publish the reverse move to clear the ledger surface.
 *
 * Like the other moves, NEVER throws for the expected "not in needs-attention"
 * case — it returns `{moved: false, reasonNotMoved}`.
 */
export function resolveFromNeedsAttention(
	options: ResolveFromNeedsAttentionOptions,
): ResolveFromNeedsAttentionResult {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	const naRel = join('work', 'needs-attention', `${slug}.md`);
	const naAbs = join(cwd, naRel);
	if (!existsSync(naAbs)) {
		return {
			moved: false,
			reasonNotMoved:
				`work/needs-attention/${slug}.md not found — nothing to resolve back ` +
				'to in-progress (wrong slug, or not in needs-attention?).',
		};
	}

	const destDir = join(cwd, 'work', 'in-progress');
	mkdirSync(destDir, {recursive: true});
	const destRel = join('work', 'in-progress', `${slug}.md`);
	gitHard(['mv', naRel, destRel], cwd, env);

	gitHard(['add', '-A'], cwd, env);
	const commitMessage = `chore(${slug}): resolve needs-attention; return to in-progress`;
	gitHard(['commit', '-q', '-m', commitMessage], cwd, env);
	const moveCommit = revParseHead(cwd, env);
	note(`Resolved '${slug}' from needs-attention back to in-progress.`);

	return {moved: true, commitMessage, moveCommit};
}

/**
 * List the `work/needs-attention/*.md` items for a repo with their recorded
 * reason — the "look here" surface `status` renders. Read-only; returns `[]`
 * when the folder is absent (the common case). Skipped by `scan`/eligibility for
 * claiming (those read only `work/backlog/`), this is the surface companion.
 */
export function readNeedsAttentionItems(
	repoPath: string,
): NeedsAttentionItem[] {
	// Resolve the needs-attention surface THROUGH the read seam's local-tree
	// method (offline). The seam returns each item's raw `content`; we extract the
	// reason prose here, exactly as the inline read did.
	const {needsAttention} = ledgerRead.resolveLocalState({repoPath});
	return needsAttention.map((item) => ({
		file: item.file,
		slug: item.slug,
		reason: extractReason(item.content),
	}));
}

/**
 * Append the reason (and any surfaced questions) to an item file as a body
 * block. We add ONLY to the body, never the frontmatter — state stays the folder
 * (WORK-CONTRACT rule 3); the reason is durable prose. A single trailing block
 * keeps it idempotent-ish and easy to read in `ls`/`status`.
 */
function appendReasonBlock(
	path: string,
	reason: string,
	questions: string[] | undefined,
): void {
	const current = readFileSync(path, 'utf8');
	const lines: string[] = [];
	// Ensure a clear separation from whatever the body ended with.
	const base = current.replace(/\s*$/, '');
	lines.push(base);
	lines.push('');
	lines.push(REASON_HEADING);
	lines.push('');
	lines.push(reason);
	if (questions && questions.length > 0) {
		lines.push('');
		lines.push('### Surfaced questions');
		lines.push('');
		for (const q of questions) {
			lines.push(`- ${q}`);
		}
	}
	lines.push('');
	writeFileSync(path, lines.join('\n'));
}

/**
 * Extract the prose written under the `## Needs attention` heading — the reason
 * `status` surfaces. Returns the first non-empty line(s) of the block as a
 * single line (stops at the next `## ` heading); '' when no block is present.
 */
function extractReason(content: string): string {
	const normalized = content.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const start = lines.findIndex((l) => l.trim() === REASON_HEADING);
	if (start === -1) {
		return '';
	}
	const collected: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^##\s/.test(line)) {
			break;
		}
		if (/^###\s/.test(line)) {
			// The questions sub-section starts here; the reason itself is above it.
			break;
		}
		if (line.trim() === '') {
			if (collected.length > 0) {
				// Stop at the first blank line AFTER we captured the reason text.
				break;
			}
			continue;
		}
		collected.push(line.trim());
	}
	return collected.join(' ').trim();
}

/** Run git; throw on non-zero (genuinely unexpected plumbing failures). */
function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	const result = run('git', args, cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
}

/** True when the index has no staged changes against HEAD (nothing to commit). */
function nothingStaged(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	// `diff --cached --quiet` exits 0 when NOTHING is staged, 1 when there is.
	return run('git', ['diff', '--cached', '--quiet'], cwd, {env}).status === 0;
}

/** The current HEAD commit sha (the just-made commit's tip). */
function revParseHead(cwd: string, env: NodeJS.ProcessEnv | undefined): string {
	const result = run('git', ['rev-parse', 'HEAD'], cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git rev-parse HEAD failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result.stdout.trim();
}
