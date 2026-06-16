import {run, type RunResult} from './git.js';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/**
 * The SHARED drop-mechanism for runner-authored `chore(<slug>): route to
 * needs-attention` MOVE-ONLY bookkeeping commits. ONE home, called at both
 * rebase sites:
 *
 *   - the INTEGRATION rebase (`integration-core.ts`
 *     `rebaseDroppingNeedsAttentionSurface`, the `recovering` path) — drops the
 *     historical `in-progress → needs-attention` move so the replay does not
 *     conflict with the surfaced main; and
 *   - the ONBOARD continue-rebase (`continue-branch.ts`
 *     `rebaseContinuedBranchOntoMain`, every CONTINUE path) — drops the kept
 *     branch's stale `route to needs-attention` moves so a single agent
 *     re-`do`'ing its own kept branch never self-conflicts with the runner's
 *     own tree-less moves of the same `.md` on main.
 *
 * THE HARD INVARIANT (do not violate): the drop targets ONLY runner-authored
 * `route to needs-attention` move-only commits, anchored to the slug. It NEVER
 * drops a COMPLETED-STATE move (the slice `→done` move, or the PRD
 * `slicing → prd-sliced` move) — those stay on the branch and land atomically
 * with their artifacts (code, emitted backlog slices). `arbiter/main` must
 * never show `done/`/`prd-sliced/` without the artifacts they assert. A genuine
 * code conflict (still present after the drop) still aborts → needs-attention.
 *
 * HOW we identify the commits to drop — and why it changed. We USED to delete
 * `pick` lines from git's RENDERED `git-rebase-todo` by `sed`-matching the
 * subject text on the line. That rendered text is a human-facing PRESENTATION
 * detail, not a stable interface: the `# ` instruction prefix, abbreviated
 * command names, hash length, and the full-subject `# %s` `instructionFormat`
 * (which became the DEFAULT in git 2.54) all change it. When the rendering
 * drifts the regex silently stops matching, the bookkeeping commit replays onto
 * a main that no longer has that ledger state, and the rebase self-conflicts
 * (the live git-2.54 CI failure).
 *
 * The robust mechanism (this module):
 *   1. IDENTIFY by a durable marker the PRODUCER stamped on the commit OBJECT —
 *      the `Agent-Runner-Bookkeeping: route-to-needs-attention` git TRAILER
 *      (`needs-attention.ts` writes it at both author sites). The trailer lives
 *      ON the commit, so it travels with the kept branch to the arbiter and to
 *      any other machine — the onboard continue-rebase runs in a FRESH process
 *      on a possibly DIFFERENT machine, so there is no in-memory value to pass.
 *      We read it with PLUMBING (`git log` over `base..HEAD`), never from the
 *      rendered todo. (A legacy un-trailered move-only commit — a branch created
 *      before the trailer landed — is still recognised by its REAL `%s` subject,
 *      also read by plumbing; see {@link computeBookkeepingDropSet}.)
 *   2. DRIVE the rebase by SHA — a `GIT_SEQUENCE_EDITOR` that REWRITES the todo
 *      from OUR computed ordered kept-sha list (`pick <fullsha>` per kept commit,
 *      dropped shas omitted, `noop` if the kept set is empty). `pick <fullsha>`
 *      is the canonical version-stable instruction git parses identically
 *      regardless of how it renders. We never read or match git's own rendered
 *      todo text, so behaviour is identical across git versions.
 */

/** The trailer key the producer stamps on every route-to-needs-attention move-only commit. */
export const BOOKKEEPING_TRAILER_KEY = 'Agent-Runner-Bookkeeping';
/** The trailer value identifying the route-to-needs-attention move-only bookkeeping commit. */
export const BOOKKEEPING_TRAILER_VALUE = 'route-to-needs-attention';
/** The full `key: value` trailer line the producer appends to the move-only commit message. */
export const BOOKKEEPING_TRAILER = `${BOOKKEEPING_TRAILER_KEY}: ${BOOKKEEPING_TRAILER_VALUE}`;

/**
 * Whether the consumer ALSO recognises an OLD un-trailered move-only commit by
 * its slug-anchored REAL `%s` subject. Kept `true` for one transition because
 * there are LIVE pre-existing kept `work/<slug>` branches on arbiters whose
 * move-only commit predates the trailer; dropping this fallback would silently
 * stop dropping on those branches (a recovery/continue on them would then
 * self-conflict). The fallback matches the REAL subject via plumbing, NEVER the
 * rendered todo line, so it does NOT reintroduce the version dependency the
 * trailer removes. See the `## Decisions` note in the done record.
 */
const LEGACY_UNTRAILERED_FALLBACK = true;

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	return run('git', args, cwd, {env});
}

/**
 * One commit on `base..HEAD` as the plumbing read returns it: the full sha, the
 * REAL subject (`%s`, never the rendered todo line), and the recorded
 * `Agent-Runner-Bookkeeping` trailer VALUE when present in the raw `%B` body
 * (empty string when absent). See {@link bodyHasBookkeepingTrailer} for why we
 * scan the raw body rather than `%(trailers:…)`.
 */
interface CommitInfo {
	sha: string;
	subject: string;
	bookkeepingTrailer: string;
}

/**
 * Does a commit's RAW message body carry the bookkeeping trailer line? We scan
 * the full `%B` body for the literal `Agent-Runner-Bookkeeping:
 * route-to-needs-attention` trailer line (whole-line, value-anchored) rather
 * than relying on `%(trailers:…)` / `git interpret-trailers --parse`. Those only
 * recognise the LAST contiguous trailer block, and the move-only commit gets a
 * `CAS-Nonce: …` trailer appended in its OWN block when it is published through
 * the tree-less ledger-write CAS (`ledger-write.ts` `stampNonce`) — the blank
 * line before that block pushes our trailer out of the "recognised" block, so
 * `%(trailers:…)` returns empty for it. Scanning the raw body is still pure
 * identification-by-recorded-trailer (the marker the producer stamped, read from
 * the commit OBJECT via plumbing) — it is NOT git's version-unstable rendered
 * rebase-todo text, which is the only thing this fix forbids.
 */
function bodyHasBookkeepingTrailer(body: string): boolean {
	const escapedKey = BOOKKEEPING_TRAILER_KEY.replace(
		/[.*+?^${}()|[\]\\]/g,
		'\\$&',
	);
	const escapedValue = BOOKKEEPING_TRAILER_VALUE.replace(
		/[.*+?^${}()|[\]\\]/g,
		'\\$&',
	);
	// A real trailer line: key, colon, optional space, the exact value, to EOL.
	return new RegExp(`^${escapedKey}:[ \t]*${escapedValue}[ \t]*$`, 'm').test(
		body,
	);
}

/**
 * Read every commit on `base..HEAD` (oldest-first, replay order) via plumbing —
 * the full sha, the REAL `%s` subject, and the RAW `%B` message body (which we
 * scan for the recorded `Agent-Runner-Bookkeeping` trailer). We use NUL field +
 * record separators so subjects/bodies with spaces or unusual characters parse
 * unambiguously, and `--reverse` so the order matches the rebase replay order
 * (the todo we regenerate must keep the kept commits in their original order).
 */
function readCommits(
	cwd: string,
	base: string,
	env: NodeJS.ProcessEnv | undefined,
): CommitInfo[] {
	// Field sep NUL (%x00), record sep RS (%x1e). The body (%B, multi-line) MUST
	// be the LAST field so its embedded newlines never confuse the split.
	const format = `%H%x00%s%x00%B%x1e`;
	const out = gitSoft(
		['log', '--reverse', `--format=${format}`, `${base}..HEAD`],
		cwd,
		env,
	).stdout;
	const commits: CommitInfo[] = [];
	for (const record of out.split('\x1e')) {
		const trimmed = record.replace(/^\n/, '');
		if (trimmed.trim() === '') {
			continue;
		}
		const [sha, subject, body] = trimmed.split('\x00');
		commits.push({
			sha: (sha ?? '').trim(),
			subject: subject ?? '',
			bookkeepingTrailer: bodyHasBookkeepingTrailer(body ?? '')
				? BOOKKEEPING_TRAILER_VALUE
				: '',
		});
	}
	return commits;
}

/**
 * The REAL-subject anchor for a slug's route-to-needs-attention move-only commit
 * (`chore(<slug>): route to needs-attention; <reason>`). Matched against the
 * commit's `%s` subject read by plumbing — NEVER against git's rendered todo
 * line. Used BOTH as the slug-guard for trailer'd commits and as the legacy
 * fallback for un-trailered ones (branches created before the trailer landed).
 */
function matchesRouteToNeedsAttentionSubject(
	subject: string,
	slug: string,
): boolean {
	return subject.startsWith(`chore(${slug}): route to needs-attention`);
}

/**
 * Compute the ordered drop-set + kept-set for a rebase of `base..HEAD`, by
 * reading the recorded `Agent-Runner-Bookkeeping` trailer (and, for back-compat,
 * the legacy real `%s` subject) via plumbing. A commit is DROPPED iff it is this
 * slug's route-to-needs-attention move-only bookkeeping commit:
 *
 *   - PRIMARY (durable): it carries the `Agent-Runner-Bookkeeping:
 *     route-to-needs-attention` trailer AND its real subject is anchored to THIS
 *     slug (`chore(<slug>): route to needs-attention…`). The subject anchor is
 *     the slug-guard — the trailer says "this is a route-to-needs-attention
 *     bookkeeping commit", the subject says "for THIS slug", so an unrelated
 *     slug's bookkeeping commit is never dropped.
 *   - LEGACY (back-compat): a commit with NO trailer whose real `%s` subject is
 *     this slug's route-to-needs-attention anchor. A kept `work/<slug>` branch
 *     created BEFORE the trailer landed carries such a commit; there are LIVE
 *     pre-existing kept branches on arbiters, so dropping this fallback would
 *     silently stop dropping on them. Matched via the REAL subject (plumbing),
 *     never the rendered todo line.
 *
 * NEVER drops a COMPLETED-STATE move: a `→done` move's subject is `feat(<slug>):
 * … done` (or similar) and a PRD `slicing → prd-sliced` move is its own subject
 * — neither is anchored to `route to needs-attention`, and the producer stamps
 * the trailer ONLY on the route-to-needs-attention move, so neither matches.
 *
 * Returns the ordered kept shas (replay order) and the dropped shas. When `slug`
 * is empty, nothing is dropped (the non-slice back-compat caller).
 */
export function computeBookkeepingDropSet(params: {
	cwd: string;
	base: string;
	slug: string;
	env: NodeJS.ProcessEnv | undefined;
}): {keep: string[]; drop: string[]} {
	const {cwd, base, slug, env} = params;
	const commits = readCommits(cwd, base, env);
	const keep: string[] = [];
	const drop: string[] = [];
	for (const commit of commits) {
		const isThisSlugSubject =
			slug !== '' && matchesRouteToNeedsAttentionSubject(commit.subject, slug);
		const hasTrailer = commit.bookkeepingTrailer === BOOKKEEPING_TRAILER_VALUE;
		// DROP iff this slug's route-to-needs-attention move-only commit. The slug
		// anchor (the real `%s` subject) is the guard that keeps the drop to THIS
		// slug. PRIMARY: the durable trailer the producer stamped. LEGACY: an
		// un-trailered commit on a pre-change kept branch (recognised by the
		// slug-anchored real subject alone). Both require the subject anchor, so a
		// completed-state move / another slug's bookkeeping never matches.
		const isBookkeeping =
			isThisSlugSubject && (hasTrailer || LEGACY_UNTRAILERED_FALLBACK);
		if (isBookkeeping) {
			drop.push(commit.sha);
		} else {
			keep.push(commit.sha);
		}
	}
	return {keep, drop};
}

/**
 * Build a one-shot `GIT_SEQUENCE_EDITOR` command that OVERWRITES the rebase todo
 * file (`$1`) with OUR computed todo — one `pick <fullsha>` line per kept commit
 * in replay order (`noop` when the kept set is empty). It never reads nor matches
 * git's rendered todo text, so the drop is identical across git versions.
 *
 * Mechanism: we write the desired todo body to a temp file and the editor is a
 * tiny `cp <tmp> "$1"` (`sh -c`). `pick <fullsha>` is the canonical
 * version-stable instruction git parses identically regardless of how it would
 * have rendered the line; dropped shas are simply absent from the file.
 */
function writeTodoSequenceEditor(keep: string[]): {
	editor: string;
	cleanup: () => void;
} {
	const body =
		keep.length > 0
			? keep.map((sha) => `pick ${sha}`).join('\n') + '\n'
			: 'noop\n';
	const dir = mkdtempSync(join(tmpdir(), 'agent-runner-rebase-todo-'));
	const todoFile = join(dir, 'todo');
	writeFileSync(todoFile, body);
	// `$1` is the path to git's todo file; overwrite it with ours. Single-quoted
	// paths so spaces are safe; the temp paths we create contain none, but be safe.
	const editor = `sh -c 'cp '\\''${todoFile}'\\'' "$1"' --`;
	return {
		editor,
		cleanup: () => rmSync(dir, {recursive: true, force: true}),
	};
}

/**
 * Rebase the CURRENTLY-CHECKED-OUT branch onto `ontoRef` while DROPPING every
 * `chore(<slug>): route to needs-attention` move-only bookkeeping commit on the
 * branch — identified by the recorded `Agent-Runner-Bookkeeping` trailer (or the
 * legacy real `%s` subject) via plumbing, and dropped by driving the rebase from
 * OUR own `pick <fullsha>` todo (see {@link computeBookkeepingDropSet} +
 * {@link writeTodoSequenceEditor}). Returns the rebase {@link RunResult} (status
 * 0 = clean replay; non-zero = the rebase conflicted on something OTHER than a
 * dropped bookkeeping commit — the caller's existing abort path governs).
 *
 * When the branch carries NO matching bookkeeping commits, the regenerated todo
 * keeps every commit and this degrades to a normal rebase onto `ontoRef`. When
 * there is no common ancestor with `ontoRef` (shouldn't happen for a branch cut
 * from main), the helper falls back to a plain `rebase <ontoRef>` so the caller's
 * conflict path still governs.
 *
 * The helper does NOT abort on conflict and does NOT advance the branch on
 * success — both are the caller's responsibility, EXACTLY as the underlying
 * `git rebase` works, so this is a drop-in replacement for a bare
 * `git rebase <ontoRef>` at either site.
 */
export function rebaseDroppingBookkeepingMoves(params: {
	cwd: string;
	ontoRef: string;
	slug: string;
	env: NodeJS.ProcessEnv | undefined;
}): RunResult {
	const {cwd, ontoRef, slug, env} = params;
	// The branch we are ON. Rebasing must UPDATE this ref — so we pass the
	// branch NAME to `git rebase` (passing the literal `HEAD` would rebase in
	// DETACHED mode and leave the branch ref behind).
	const onBranch = gitSoft(
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		cwd,
		env,
	).stdout.trim();
	const base = gitSoft(['merge-base', 'HEAD', ontoRef], cwd, env).stdout.trim();
	if (base === '') {
		// No common ancestor: fall back to a plain rebase so the caller's
		// conflict path still governs.
		return gitSoft(['rebase', ontoRef], cwd, env);
	}
	// Identify the commits to drop by the RECORDED trailer (plumbing), never the
	// rendered todo. The kept shas drive OUR regenerated todo.
	const {keep} = computeBookkeepingDropSet({cwd, base, slug, env});
	const {editor, cleanup} = writeTodoSequenceEditor(keep);
	try {
		const rebaseEnv: NodeJS.ProcessEnv = {
			...(env ?? process.env),
			// Our own todo (drop by sha) — NO dependence on git's rendered todo text.
			GIT_SEQUENCE_EDITOR: editor,
			// Keep the rebase non-interactive for the commit-message editor too.
			GIT_EDITOR: 'true',
		};
		return gitSoft(
			onBranch === ''
				? ['rebase', '-i', '--onto', ontoRef, base]
				: ['rebase', '-i', '--onto', ontoRef, base, onBranch],
			cwd,
			rebaseEnv,
		);
	} finally {
		cleanup();
	}
}
