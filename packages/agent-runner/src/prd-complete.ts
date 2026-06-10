import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {parseFrontmatter} from './frontmatter.js';

/**
 * The read-only **"is this PRD complete?"** core query (PRD `issue-intake`, US #8 —
 * the closure-linkage half). Given a PRD slug + a `work/` tree, a PRD is COMPLETE
 * iff there is **≥1 slice carrying `prd:<slug>`** AND **all such slices reside in
 * `work/done/`**. Pure `work/`-folder logic — no seam, no git, no `gh`, no mutation.
 *
 * This is the LINKAGE the intake engine emits for CI to ACT on: a PRD fans out to N
 * slices = N PRs whose slices carry `prd:` ONLY (no `Refs #N` keyword is emitted),
 * and the issue is closed by CI's merge-to-main JOB that runs THIS query +
 * `closeIssue`. That close JOB is `runner-in-ci`'s — NOT
 * built here; this module exposes ONLY the query for the job to call. The issue
 * number lives ONLY on the PRD (`issue:`); slices link via `slice.prd: → PRD`, so
 * this query keys on the SAME `prd:` field that hop uses.
 *
 * It is a `work/`-FOLDER RESIDENCE scan keyed on the parsed `prd:` field — NOT the
 * claim ledger (`ledger-read.ts` resolves claim-STATE, a different concern). It
 * reuses {@link parseFrontmatter} (the `prd:` field) rather than hand-rolling a YAML
 * parse, and scans the slice lifecycle folders directly: `work/backlog/`,
 * `work/in-progress/`, `work/needs-attention/`, and `work/done/`. A slice that has
 * NOT yet landed in `work/done/` (still in backlog / in-progress / needs-attention)
 * means the PRD is not yet complete.
 */

/** The slice lifecycle folders a `prd:<slug>` slice can reside in. */
const SLICE_FOLDERS = [
	'backlog',
	'in-progress',
	'needs-attention',
	'done',
] as const;

/** Where a slice resides — the folder name under `work/`. */
type SliceFolder = (typeof SLICE_FOLDERS)[number];

/** What the query needs: which repo's `work/` tree to scan + which PRD slug. */
export interface PrdCompleteInput {
	/** The repo working-tree root whose `work/` slice folders to scan. */
	repoPath: string;
	/** The PRD slug to check (matched against each slice's frontmatter `prd:`). */
	slug: string;
}

/** One slice carrying `prd:<slug>`, with the folder it resides in. */
export interface PrdSlice {
	/** Filename within `work/<folder>/` (e.g. `add-quiet-flag.md`). */
	file: string;
	/** The slice's resolved slug (frontmatter `slug:`, falling back to filename). */
	slug: string;
	/** Which slice folder it resides in. */
	folder: SliceFolder;
}

/**
 * The result of the "is this PRD complete?" query. {@link complete} is the
 * load-bearing verdict; {@link slices} surfaces the matched set (with residence)
 * so a caller can explain the verdict if it wants to.
 */
export interface PrdCompleteResult {
	/**
	 * `true` iff ≥1 slice carries `prd:<slug>` AND every such slice resides in
	 * `work/done/`. `false` when no slice carries the slug (≥1 is REQUIRED) OR when
	 * any matching slice is still outside `work/done/`.
	 */
	complete: boolean;
	/** Every slice carrying `prd:<slug>`, across all slice folders, sorted by slug. */
	slices: PrdSlice[];
}

/** List the `.md` filenames in `<repoPath>/work/<folder>/`, sorted; `[]` if absent. */
function listMarkdown(repoPath: string, folder: SliceFolder): string[] {
	const dir = join(repoPath, 'work', folder);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.filter((name) => name.toLowerCase().endsWith('.md')).sort();
}

/**
 * Is this PRD COMPLETE? Read-only: scan the slice lifecycle folders, parse each
 * slice's `prd:` via {@link parseFrontmatter}, keep those whose `prd:` equals
 * `slug`, and return COMPLETE iff that set is NON-EMPTY and EVERY member resides in
 * `work/done/`. Touches no git, no network, no mutation — a pure `work/`-folder
 * residence scan keyed on the parsed `prd:` field.
 */
export function isPrdComplete(input: PrdCompleteInput): PrdCompleteResult {
	const {repoPath, slug} = input;
	const slices: PrdSlice[] = [];
	for (const folder of SLICE_FOLDERS) {
		for (const file of listMarkdown(repoPath, folder)) {
			const content = readFileSync(
				join(repoPath, 'work', folder, file),
				'utf8',
			);
			const fm = parseFrontmatter(content);
			if (fm.prd === slug) {
				slices.push({
					file,
					slug: fm.slug ?? basename(file, '.md'),
					folder,
				});
			}
		}
	}
	slices.sort((a, b) => a.slug.localeCompare(b.slug));

	// COMPLETE iff ≥1 such slice AND every one of them is in `work/done/`.
	const complete =
		slices.length > 0 && slices.every((s) => s.folder === 'done');
	return {complete, slices};
}
