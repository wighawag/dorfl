import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {parseFrontmatter} from './frontmatter.js';
import {run} from './git.js';
import {
	LEDGER_STATUS_FOLDERS,
	type LedgerStatusFolder,
	workFolderName,
	workFolderPath,
	workFolderPrefix,
	isWorkItemFile,
} from './work-layout.js';

/**
 * The **one-slug-one-folder LINT** over the `work/` lifecycle ledger (prd
 * `ledger-integrity`, story 3 — the READ-side belt-and-suspenders for defect 1).
 *
 * `work/` IS the ledger: a task's STATUS is the FOLDER its single `.md` lives in
 * (WORK-CONTRACT.md rule "status = the folder", no index, one file per item). The
 * invariant the integration core ENFORCES on every transition
 * (`integration-core.ts` `readArbiterLedgerPlacement`, task
 * `atomic-done-move-one-slug-one-folder`) is that a slug rests in EXACTLY ONE
 * status folder. This module is its READER: a derived check that lists every
 * status folder and surfaces any slug present in MORE THAN ONE — so a PRE-EXISTING
 * orphan (e.g. the one hand-cleaned in `279b542`, PR #86) is DISCOVERABLE and a
 * drive isn't misled into "recovering" an already-done task.
 *
 * It NEVER fixes the corruption: it WARNS (in `status`/`scan`) and REPORTS (the
 * `gc`-style sweep, {@link sweepLedgerDuplicates}); a HUMAN resolves the
 * duplicate (keep the canonical copy, delete the stale one). This mirrors the
 * capture-bucket contract's "the agent never auto-deletes a signal" and the
 * integration core's "fail loud over silent-clean where ambiguous".
 *
 * Consistent with the integration core's enforcement (which derives placement
 * from the arbiter on demand, no index), the lint DERIVES the duplicate set by
 * listing folder residence — there is no shared index to consult.
 */

/**
 * The `work/` STATUS folders a task's ledger file can rest in — the
 * one-slug-one-folder set this lint is asserted over (WORK-CONTRACT.md
 * "status = the folder"). After the capstone cut-over (task
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`, prd
 * `ledger-status-per-item-lock-refs`; ADR `ledger-status-on-per-item-lock-refs`)
 * the ONLY `work/` moves on `main` are the DURABLE RESTING transitions, so a
 * task's ledger file can rest only in the DURABLE set: the pool `backlog/`, the
 * terminal `done/`, and the task regime's PER-REGIME "won't-proceed" terminal
 * `tasks/cancelled/` (the per-regime split of the previous shared `dropped/`, prd
 * `folder-taxonomy-reorg-and-rename` US #10; the specific REASON lives in the item
 * BODY as a `reason:` value). The prd regime's terminal `prds/dropped/` is a
 * SEPARATE namespace and is NOT a task-status folder. The transient
 * `in-progress`/`needs-attention`/`tasking`/
 * `advancing` are GONE from `main`'s tree — they are per-item lock-ref state
 * (`in-progress` = lock held active, `needs-attention` = lock held stuck), read
 * via `agent-runner status` / `gc --ledger`'s lock report, NOT an `ls`-able folder.
 *
 * Shares `integration-core.ts`'s `LEDGER_STATUS_FOLDERS` (`backlog`/`done`/
 * `cancelled`). A read-side lint surfaces a slug that ends up in `tasks/cancelled/`
 * AND another status folder, so the lint covers all three.
 *
 * The capture buckets (`ideas`/`observations`/`findings`) and the prd-flow folders
 * (`prds/ready`/`prds/tasked`) are NOT task-status folders (WORK-CONTRACT.md: the buckets
 * are "exempt from status = folder"; the prd folders carry prds, a separate
 * namespace) — they are deliberately EXCLUDED so a slug that legitimately has both
 * a task and a same-named note/prd is never a false positive.
 */
export {LEDGER_STATUS_FOLDERS, type LedgerStatusFolder} from './work-layout.js';

/**
 * Lifecycle precedence used to pick the CANDIDATE CANONICAL folder of a duplicate
 * (the one the human most likely wants to KEEP — the most-advanced lifecycle
 * stage). `done/` is the canonical destination of the done-move (it wins, matching
 * the integration core's "candidate `done/` destination"); the earlier stages
 * rank below it. This is ONLY a suggestion for the human — the lint NEVER deletes
 * the others; it just names the likely keeper.
 */
const CANONICAL_PRECEDENCE: readonly LedgerStatusFolder[] = [
	'done',
	'cancelled',
	'tasks-ready',
];

/** One slug found in more than one status folder — the corruption to surface. */
export interface DuplicateSlug {
	/** The slug present in multiple status folders. */
	slug: string;
	/** The status folders it appears in (sorted, lifecycle order). */
	folders: LedgerStatusFolder[];
	/**
	 * The CANDIDATE canonical folder a human most likely wants to keep (the
	 * most-advanced lifecycle stage among {@link folders}). A SUGGESTION only — the
	 * lint never acts on it.
	 */
	candidateCanonical: LedgerStatusFolder;
}

/**
 * Detect every slug present in MORE THAN ONE status folder, from a per-folder map
 * of the slugs each holds. PURE (no I/O) so it is trivially testable and shared by
 * both the local-tree and ref-tree readers. Returns the duplicates sorted by slug,
 * each carrying the folders it appears in (lifecycle-ordered) and the candidate
 * canonical folder. An empty result ⇒ a clean ledger.
 */
export function detectDuplicateSlugs(
	slugsByFolder: ReadonlyMap<LedgerStatusFolder, ReadonlySet<string>>,
): DuplicateSlug[] {
	const foldersBySlug = new Map<string, LedgerStatusFolder[]>();
	for (const folder of LEDGER_STATUS_FOLDERS) {
		const slugs = slugsByFolder.get(folder);
		if (slugs === undefined) {
			continue;
		}
		for (const slug of slugs) {
			const list = foldersBySlug.get(slug) ?? [];
			list.push(folder);
			foldersBySlug.set(slug, list);
		}
	}

	const duplicates: DuplicateSlug[] = [];
	for (const [slug, folders] of foldersBySlug) {
		if (folders.length < 2) {
			continue;
		}
		const ordered = orderByLifecycle(folders);
		duplicates.push({
			slug,
			folders: ordered,
			candidateCanonical: ordered[0],
		});
	}
	return duplicates.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Sort folders by lifecycle precedence (most-advanced stage first). */
function orderByLifecycle(
	folders: readonly LedgerStatusFolder[],
): LedgerStatusFolder[] {
	return [...folders].sort(
		(a, b) => CANONICAL_PRECEDENCE.indexOf(a) - CANONICAL_PRECEDENCE.indexOf(b),
	);
}

// --- Resolving slug→folder placement from the two real read sources ----------

/** List the `.md` slugs in `<repoPath>/work/<folder>/` (frontmatter `slug:`, else filename). */
function readLocalFolderSlugs(
	repoPath: string,
	folder: LedgerStatusFolder,
): Set<string> {
	const dir = workFolderPath(repoPath, folder);
	const slugs = new Set<string>();
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return slugs; // missing folder ⇒ nothing there
	}
	for (const file of entries) {
		if (!isWorkItemFile(file)) {
			continue;
		}
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		slugs.add(fm.slug ?? basename(file, '.md'));
	}
	return slugs;
}

/**
 * Resolve the per-folder slug placement of a LOCAL working tree's `work/` ledger
 * (offline `readdirSync`). The duplicate set is then {@link detectDuplicateSlugs}.
 */
export function resolveLocalPlacement(
	repoPath: string,
): Map<LedgerStatusFolder, Set<string>> {
	const placement = new Map<LedgerStatusFolder, Set<string>>();
	for (const folder of LEDGER_STATUS_FOLDERS) {
		placement.set(folder, readLocalFolderSlugs(repoPath, folder));
	}
	return placement;
}

/** Detect duplicate slugs across the status folders of a LOCAL working tree. */
export function lintLocalLedger(repoPath: string): DuplicateSlug[] {
	return detectDuplicateSlugs(resolveLocalPlacement(repoPath));
}

/** List the `.md` slugs in `<ref>:work/<folder>/` on a committed tree (bare-mirror or any ref). */
function readRefFolderSlugs(
	ref: string,
	cwd: string,
	folder: LedgerStatusFolder,
	env: NodeJS.ProcessEnv | undefined,
): Set<string> {
	const slugs = new Set<string>();
	const tree = run(
		'git',
		['ls-tree', '--name-only', `${ref}:work/${workFolderName(folder)}`],
		cwd,
		{env},
	);
	if (tree.status !== 0) {
		return slugs; // folder absent on this ref ⇒ nothing there
	}
	for (const name of tree.stdout.split('\n')) {
		const file = name.trim();
		if (!isWorkItemFile(file)) {
			continue;
		}
		// The ledger names each file after its slug (claim/done moves do); reading
		// the blob to confirm frontmatter `slug:` would cost an extra `git show` per
		// file, and the duplicate set is keyed on the filename the transition wrote.
		slugs.add(file.slice(0, -'.md'.length));
	}
	return slugs;
}

/**
 * Resolve the per-folder slug placement from a committed `work/` tree on a git REF
 * (a BARE hub mirror's `main`, or any ref), via `git ls-tree` — the only mechanism
 * that works against a bare repo (no working tree), the SAME one the read seam's
 * mirror method uses. `cwd` is the repo the `git -C <cwd>` commands run in (the
 * mirror itself).
 */
export function resolveRefPlacement(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Map<LedgerStatusFolder, Set<string>> {
	const placement = new Map<LedgerStatusFolder, Set<string>>();
	for (const folder of LEDGER_STATUS_FOLDERS) {
		placement.set(folder, readRefFolderSlugs(ref, cwd, folder, env));
	}
	return placement;
}

/** Detect duplicate slugs across the status folders of a committed ledger ref. */
export function lintRefLedger(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): DuplicateSlug[] {
	return detectDuplicateSlugs(resolveRefPlacement(ref, cwd, env));
}

// --- Formatting (the loud WARNING + the gc-style REPORT) ---------------------

/**
 * Format the one-slug-one-folder WARNING lines for a set of duplicates — the LOUD
 * surface `status`/`scan` print when the ledger is corrupt. Each line names the
 * slug AND the folders it appears in (never a silent pass). Empty input ⇒ no
 * lines (a clean ledger is silent here).
 */
export function formatDuplicateWarnings(
	duplicates: readonly DuplicateSlug[],
): string[] {
	if (duplicates.length === 0) {
		return [];
	}
	const lines = [
		`!! one-slug-one-folder VIOLATED: ${duplicates.length} slug(s) in more than ` +
			'one work/ status folder (a corrupt ledger — a human must resolve each):',
	];
	for (const dup of duplicates) {
		const where = dup.folders.map((f) => workFolderPrefix(f)).join(', ');
		lines.push(
			`   ${dup.slug}: in ${where} ` +
				`(candidate canonical: ${workFolderPrefix(dup.candidateCanonical)})`,
		);
	}
	return lines;
}

/** The result of the `gc`-style ledger sweep — a REPORT, never a deletion. */
export interface LedgerSweepResult {
	/** Every slug present in more than one status folder (empty ⇒ clean ledger). */
	duplicates: DuplicateSlug[];
}

/**
 * The `gc`-STYLE ledger SWEEP (prd story 3's belt-and-suspenders): on demand,
 * REPORT every slug present in more than one status folder of a LOCAL `work/`
 * ledger, naming the folders and the CANDIDATE canonical folder — and NEVER
 * auto-delete. A human confirms the cleanup (keep the canonical copy, delete the
 * stale one), exactly like the manual `279b542` cleanup. This is a `gc`-style
 * sweep (it surveys + reports a hazard for a human to act on), but it is a
 * SEPARATE surface from the worktree reaper `gc` (`gc.ts`), which reaps job
 * worktrees under `<workspacesDir>/work/*` — a DIFFERENT `work/` (the execution
 * substrate, not the lifecycle ledger). Mixing the two would conflate the two
 * meanings of `work/`; the read seam already keeps the worktree `gc` out of the
 * ledger read.
 */
export function sweepLedgerDuplicates(repoPath: string): LedgerSweepResult {
	return {
		duplicates: lintLocalLedger(repoPath),
	};
}

/**
 * Format the `gc`-style ledger sweep REPORT for the terminal: one block per
 * duplicate (slug, the folders it appears in, the candidate canonical folder, and
 * the explicit "resolved by a HUMAN, never auto-deleted" note), or a clean line
 * when there is nothing to report. The transient lock surface (held/stuck/orphaned
 * per-item locks, incl. the advance holds that used to be `work/advancing/`
 * markers) is the SEPARATE unified-lock report (`reportItemLocks` /
 * `formatItemLockReport`, cleared via `release-lock`), not this folder lint.
 */
export function formatLedgerSweep(result: LedgerSweepResult): string {
	const {duplicates} = result;
	if (duplicates.length === 0) {
		return 'Ledger clean: every slug is in exactly one work/ status folder.';
	}
	const lines: string[] = [];
	lines.push(
		`Ledger SWEEP: ${duplicates.length} slug(s) present in more than one work/ ` +
			'status folder (REPORT only — a human resolves each; NEVER auto-deleted):',
	);
	for (const dup of duplicates) {
		lines.push(`  ${dup.slug}`);
		lines.push(
			`    in: ${dup.folders.map((f) => workFolderPrefix(f)).join(', ')}`,
		);
		lines.push(
			`    candidate canonical: ${workFolderPrefix(dup.candidateCanonical)}`,
		);
		lines.push(
			'    resolve: keep the canonical copy, delete the stale one(s), then re-run.',
		);
	}
	return lines.join('\n');
}
