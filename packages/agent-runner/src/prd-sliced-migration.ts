import {existsSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {parseFrontmatter} from './frontmatter.js';
import {runAsync, type RunResult} from './git.js';

/**
 * The **`prd-sliced/` BACKFILL migration** (slice `prd-sliced-folder-step-a` / PRD
 * `slicing-coherence` US #11). STEP A makes `work/prd-sliced/` the SOURCE OF TRUTH
 * for sliced-ness (folder = truth, like `done/` for slices). Before this slice,
 * sliced-ness lived ONLY in the PRD's `sliced:` frontmatter marker; so a PRD that
 * was already sliced sits in `work/prd/<slug>.md` carrying a `sliced:` marker but
 * NOT yet in `work/prd-sliced/`.
 *
 * This ONE-SHOT migration moves every such PRD `work/prd/<slug>.md` (carrying a
 * `sliced:` marker) into `work/prd-sliced/<slug>.md`, so the new folder is the
 * complete, canonical view from day one. The `sliced:` marker is KEPT on the moved
 * file (it is a DERIVED COPY during Step A; its removal is the separate
 * `remove-sliced-marker-step-b` slice). A PRD with no `sliced:` marker (genuinely
 * still to-slice) is left in `work/prd/` untouched.
 *
 * The move is a `git mv` so the rename is recorded as a rename (and the runner's
 * single `git add -A` commit folds it in). It is OFFLINE and local: no arbiter,
 * no push — the caller (a one-shot migration invocation, or a future `setup`/
 * `scaffold` fixup) owns the commit. Idempotent: a PRD already resident in
 * `work/prd-sliced/` is not re-moved (a second run is a no-op).
 */

/** One PRD the backfill moved `work/prd/ -> work/prd-sliced/`. */
export interface BackfilledPrd {
	/** The PRD's resolved slug (frontmatter `slug:`, falling back to the filename). */
	slug: string;
	/** The source path it moved FROM (repo-relative). */
	from: string;
	/** The destination path it moved TO (repo-relative). */
	to: string;
}

/** The result of one backfill run. */
export interface BackfillResult {
	/** The PRDs moved `work/prd/ -> work/prd-sliced/` (sorted by slug). */
	moved: BackfilledPrd[];
}

/** List `*.md` files in `dir`, sorted; an absent dir reads as empty. */
function listMarkdown(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.filter((name) => name.toLowerCase().endsWith('.md')).sort();
}

/**
 * Run the `prd-sliced/` backfill on `repoPath`'s `work/` tree: move every
 * `work/prd/<slug>.md` carrying a `sliced:` frontmatter marker into
 * `work/prd-sliced/<slug>.md` via `git mv`, KEEPING the marker (a derived copy in
 * Step A). Returns the moves performed. Does NOT commit or push (the caller owns
 * the git transition). Idempotent.
 */
export async function backfillSlicedPrds(
	repoPath: string,
	env?: NodeJS.ProcessEnv,
): Promise<BackfillResult> {
	const prdDir = join(repoPath, 'work', 'prd');
	const moved: BackfilledPrd[] = [];
	for (const file of listMarkdown(prdDir)) {
		const content = readFileSync(join(prdDir, file), 'utf8');
		const fm = parseFrontmatter(content);
		if (fm.sliced === undefined) {
			// Genuinely still to-slice — leave it in work/prd/.
			continue;
		}
		const from = `work/prd/${file}`;
		const to = `work/prd-sliced/${file}`;
		const toAbs = join(repoPath, to);
		// Idempotence / safety: never clobber an existing resting file.
		if (existsSync(toAbs)) {
			continue;
		}
		mkdirSync(dirname(toAbs), {recursive: true});
		await gitMv(from, to, repoPath, env);
		moved.push({slug: fm.slug ?? basename(file, '.md'), from, to});
	}
	moved.sort((a, b) => a.slug.localeCompare(b.slug));
	return {moved};
}

/** `git mv <from> <to>`; throw on failure (an unexpected plumbing error). */
async function gitMv(
	from: string,
	to: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	const result = await runAsync('git', ['mv', from, to], cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git mv ${from} ${to} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result;
}
