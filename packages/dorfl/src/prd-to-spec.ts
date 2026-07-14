import {
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	rmdirSync,
} from 'node:fs';
import {join, basename} from 'node:path';
import {run, git, gitMv} from './git.js';
import {WORK_ROOT} from './work-layout.js';
import {repoConfigPath} from './repo-config.js';
import {
	resyncProtocol,
	PROTOCOL_DOCS,
	type ResyncedDoc,
	type ResyncResult,
} from './resync-protocol.js';

// The protocol re-sync now lives in the shared `resync-protocol.ts` module (so
// the standalone `dorfl sync` command and this migration engine share ONE
// implementation). Re-exported here for backward compatibility with existing
// importers/tests that reach for these symbols on `prd-to-spec.js`.
export {resyncProtocol, PROTOCOL_DOCS};
export type {ResyncedDoc, ResyncResult};

/**
 * The **`dorfl prd-to-spec` migration ENGINE** (spec
 * `prd-to-spec-vocabulary-cutover-and-migration-command`, ADR
 * `methodology-and-skills.md` §7e, user stories 4-9).
 *
 * This is the reusable, verb-agnostic core the thin `dorfl prd-to-spec` CLI
 * shell drives. It migrates a repo's `work/` DATA + config + inert git refs from
 * the legacy `prd` vocabulary to `spec`, AFTER dorfl's CODE + CONTRACT already
 * speak `spec` (the source-part cutover — batches 1-5 + the contract task — is a
 * hard prerequisite; this command reads the new `work-layout.ts` folder names
 * and reuses the leak-scan proof).
 *
 * # Decision B — self-contained
 *
 * `runPrdToSpec` does three things IN ORDER (ADR §7e):
 *
 *   1. **Quiescence check** (refuse loudly): the tree is clean AND no per-item
 *      lock is held AND no in-progress `work/prd-*`/`work/spec-*` branch carries
 *      unlanded work. On failure it NAMES the offender and does nothing (1a).
 *   2. **Setup contract re-sync FIRST:** copy the package's canonical
 *      `work/protocol/*` docs (the new `spec` contract) into the target repo and
 *      bump `work/protocol/VERSION` — the deterministic slice of what the `setup`
 *      SKILL does, so the migrated repo picks up the new contract in one command.
 *   3. **Four-layer DATA migration** (deterministic — done-items ARE converted):
 *      (a) FOLDERS `work/prds/{proposed,ready,tasked,dropped}/ → work/specs/…`
 *      via `git mv`; (b) FRONTMATTER/body `prd: → spec:` + inert path/token refs
 *      across ALL items INCLUDING `work/tasks/done/` and `work/specs/tasked/`;
 *      (c) CONFIG `dorfl.json` (`prdsLandIn → specsLandIn`, keep-case);
 *      (d) LIVE GIT REFS (inert lock-refs `refs/dorfl/lock/prd-<slug>` and
 *      work-branches `work/prd-<slug>` — the quiescence gate guarantees none are
 *      held/in-flight, so this renames only INERT refs).
 *
 * `--dry-run` reports exactly what each layer WOULD do, touching nothing.
 * A second run on an already-migrated repo is a no-op (idempotent): each layer
 * skips what is already in the `spec` shape.
 *
 * # Reusable-by-construction (user story 9)
 *
 * The layers are exported as INDEPENDENT pieces ({@link checkQuiescence},
 * {@link resyncProtocol}, {@link migrateFolders}, {@link migrateItemContent},
 * {@link migrateConfig}, {@link migrateRefs}, {@link keepCaseReplace},
 * {@link scanForLeaks}) so a FUTURE vocabulary cutover reuses the STRUCTURE
 * rather than re-deriving it — even though the verb itself stays purpose-named
 * `prd-to-spec` (ADR §7e: no general `migrate <from> <to>`). The one place the
 * `prd`/`spec` tokens are pinned is {@link MIGRATION}: a future cutover supplies
 * a different {@link VocabularyMigration} and the same engine runs.
 *
 * # TOOLING decision — bespoke keep-case sweep, not `change-case`/`change-name`
 *
 * The parent spec's "Rename TOOLING" note asks to evaluate npm `change-case` /
 * `change-name` for the keep-case sweep. Both were evaluated and DECLINED:
 * `change-case` is a case CONVERTER (`camelCase ↔ snake_case`), not a
 * keep-case find/replace of a substring across its case variants, and
 * `change-name` renames FILES. The tokens this DATA migration rewrites are a
 * small FIXED set (`prd`/`Prd`/`PRD` → `spec`/`Spec`/`SPEC`, plus the exact keys
 * `prdsLandIn`, path prefixes `work/prds/`, `prd-`), so a dependency-free
 * {@link keepCaseReplace} (3 case variants) is simpler, has no false-positive
 * surface a generic tool would add, and keeps this package at its single runtime
 * dependency. The forward+reverse {@link scanForLeaks} is the PROOF the sweep is
 * complete regardless of the tool, so the bespoke choice carries no risk the
 * gate would not catch. (Recorded here per the task's "record the choice"
 * criterion — a JSDoc at the choice site.)
 */

// ───────────────────────────────────────────────────────────────────────────
// The vocabulary the migration pins (a future cutover swaps this ONE value).
// ───────────────────────────────────────────────────────────────────────────

/**
 * A single vocabulary cutover the engine enacts: the retired word `from` (all
 * three case variants) → the new word `to`. The `prd → spec` migration pins
 * {@link MIGRATION}; a future cutover supplies a different value and reuses the
 * same engine (user story 9). `configKeys` are the exact `dorfl.json` keys that
 * carry the `from` word (their VALUES are preserved — only the key renames).
 */
export interface VocabularyMigration {
	/** The retired word, lower-case (e.g. `'prd'`). */
	from: string;
	/** The new word, lower-case (e.g. `'spec'`). */
	to: string;
	/** The retired plural folder segment under `work/` (e.g. `'prds'`). */
	fromFolder: string;
	/** The new plural folder segment under `work/` (e.g. `'specs'`). */
	toFolder: string;
	/** Exact config KEY renames (value preserved), e.g. `prdsLandIn → specsLandIn`. */
	configKeys: ReadonlyArray<{from: string; to: string}>;
}

/** The `prd → spec` cutover this verb enacts (ADR §7e). */
export const MIGRATION: VocabularyMigration = {
	from: 'prd',
	to: 'spec',
	fromFolder: 'prds',
	toFolder: 'specs',
	configKeys: [{from: 'prdsLandIn', to: 'specsLandIn'}],
};

// ───────────────────────────────────────────────────────────────────────────
// Layer: keep-case replace (the bespoke sweep — see the tooling JSDoc above).
// ───────────────────────────────────────────────────────────────────────────

/** Upper-case the first letter of a word (`prd → Prd`). */
function capitalise(word: string): string {
	return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}

/**
 * Keep-case replace EVERY occurrence of `from` with `to` across the three case
 * variants — lower (`prd → spec`), Capitalised (`Prd → Spec`), and UPPER
 * (`PRD → SPEC`) — preserving the shape of each hit. Deliberately does a plain
 * substring replace (no word boundary) so it rewrites `prd` inside identifiers
 * like `prdsLandIn`/`work/prds/`; callers scope it to the tokens they mean to
 * rewrite (a whole config key, a frontmatter-field line, a path). The bespoke
 * dependency-free sweep the tooling JSDoc justifies over `change-case`.
 */
export function keepCaseReplace(
	text: string,
	from: string,
	to: string,
): string {
	const variants: ReadonlyArray<[string, string]> = [
		[from.toUpperCase(), to.toUpperCase()],
		[capitalise(from), capitalise(to)],
		[from.toLowerCase(), to.toLowerCase()],
	];
	let out = text;
	for (const [f, t] of variants) {
		out = out.split(f).join(t);
	}
	return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Layer 1: the quiescence check (refuse loudly — ADR §7e decision 1a).
// ───────────────────────────────────────────────────────────────────────────

/** Why the repo is NOT quiescent (the FIRST offending clause, in check order). */
export interface QuiescenceViolation {
	kind: 'dirty-tree' | 'held-lock' | 'in-progress-branch';
	/** The offender, NAMED (a lock entry, a branch ref, or dirty-file paths). */
	offender: string;
}

/**
 * Is the repo QUIESCENT enough to migrate (ADR §7e, 1a)? Refuse if ANY of:
 *   - the working tree is DIRTY (uncommitted/untracked changes), OR
 *   - a per-item LOCK ref is held (`refs/dorfl/lock/*`), OR
 *   - an in-progress `work/<from>-*`/`work/<to>-*` work-branch exists (a branch
 *     that is NOT merged into the current tip = unlanded work in flight).
 *
 * Returns the FIRST violation (dirty tree dominates, then locks, then branches),
 * naming the offender, or `undefined` when quiescent. Read-only: it inspects the
 * LOCAL repo's refs + status (the fixture/downstream case where the migration
 * runs in-place). The quiescence gate is what makes layer (d) safe: with no held
 * lock and no in-flight branch, only INERT refs remain to rename.
 */
export function checkQuiescence(
	repoPath: string,
	migration: VocabularyMigration = MIGRATION,
	env: NodeJS.ProcessEnv | undefined = undefined,
): QuiescenceViolation | undefined {
	// 1. Dirty tree dominates — never migrate over uncommitted work.
	const status = run('git', ['status', '--porcelain'], repoPath, {env});
	if (status.status !== 0) {
		return {kind: 'dirty-tree', offender: '(git status failed)'};
	}
	const dirty = status.stdout
		.split('\n')
		.map((l) => l.trimEnd())
		.filter((l) => l !== '');
	if (dirty.length > 0) {
		return {
			kind: 'dirty-tree',
			offender: dirty.map((l) => l.slice(3).trim()).join(', '),
		};
	}

	// 2. A held per-item lock ref (`refs/dorfl/lock/<entry>`). Any such LOCAL ref
	//    means an item is claimed/in-flight — refuse, naming the entry.
	const locks = run(
		'git',
		['for-each-ref', '--format=%(refname)', 'refs/dorfl/lock/'],
		repoPath,
		{env},
	);
	if (locks.status === 0) {
		const held = locks.stdout
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l.startsWith('refs/dorfl/lock/'));
		if (held.length > 0) {
			return {kind: 'held-lock', offender: held[0]};
		}
	}

	// 3. An in-progress `work/<from>-*` / `work/<to>-*` branch carrying UNLANDED
	//    work (a local branch not merged into HEAD). A branch already merged into
	//    the current tip is inert; an unmerged one is work in flight — refuse.
	const branches = run(
		'git',
		[
			'for-each-ref',
			'--format=%(refname:short)',
			`refs/heads/${WORK_ROOT}/${migration.from}-*`,
			`refs/heads/${WORK_ROOT}/${migration.to}-*`,
		],
		repoPath,
		{env},
	);
	if (branches.status === 0) {
		const names = branches.stdout
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l !== '');
		for (const branch of names) {
			// Merged into the current tip ⇒ inert (safe to rename); otherwise it
			// carries unlanded work ⇒ refuse, naming the branch.
			const merged = run(
				'git',
				['merge-base', '--is-ancestor', branch, 'HEAD'],
				repoPath,
				{env},
			);
			if (merged.status !== 0) {
				return {kind: 'in-progress-branch', offender: branch};
			}
		}
	}

	return undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Layer 3a: the FOLDER move (in lockstep with work-layout.ts).
// ───────────────────────────────────────────────────────────────────────────

/** The four lifecycle sub-folders under `work/<from>s/` the move relocates. */
const LIFECYCLE_SUBFOLDERS = [
	'proposed',
	'ready',
	'tasked',
	'dropped',
] as const;

/** One folder the move relocated (or would relocate). */
export interface FolderMove {
	from: string;
	to: string;
}

/**
 * Move `work/<from>s/{proposed,ready,tasked,dropped}/ → work/<to>s/…`. The
 * DESTINATION spellings match `work-layout.ts`'s post-cutover folder names in
 * lockstep — this layer moves the DATA folders the CODE already renamed.
 *
 * A sub-folder with TRACKED files is `git mv`'d (renames preserve history); a
 * sub-folder that exists on disk but has NO tracked files (an empty staging dir
 * `setup` created — git never tracks empty dirs, so `git mv` would fatal on it)
 * is instead removed with a plain `rmdir` so no stray `work/<from>s/` folder is
 * left to leak (the empty dir carries no data). Only folders that EXIST are
 * touched (an absent sub-folder is skipped), so it is idempotent AND
 * partial-repo safe: a second run finds `work/<from>s/*` gone and does nothing.
 * `dryRun` reports the moves without touching git or the filesystem.
 */
export function migrateFolders(
	repoPath: string,
	migration: VocabularyMigration = MIGRATION,
	options: {dryRun?: boolean} = {},
): FolderMove[] {
	const moves: FolderMove[] = [];
	for (const sub of LIFECYCLE_SUBFOLDERS) {
		const fromRel = `${WORK_ROOT}/${migration.fromFolder}/${sub}`;
		const toRel = `${WORK_ROOT}/${migration.toFolder}/${sub}`;
		const fromAbs = join(repoPath, fromRel);
		if (!existsSync(fromAbs)) {
			continue;
		}
		const tracked = run('git', ['ls-files', '--', fromRel], repoPath)
			.stdout.split('\n')
			.some((l) => l.trim() !== '');
		if (!tracked) {
			// An empty/untracked on-disk staging dir: nothing for git to move, but
			// leave no stray `work/<from>s/` behind. Best-effort rmdir (only removes
			// an empty dir; a dir with untracked files stays and is reported).
			if (!options.dryRun) {
				try {
					rmdirSync(fromAbs);
				} catch {
					// non-empty untracked dir — leave it; the leak scan will surface it.
				}
			}
			continue;
		}
		moves.push({from: fromRel, to: toRel});
		if (!options.dryRun) {
			gitMv(fromRel, toRel, repoPath);
		}
	}
	// Prune a now-empty `work/<from>s/` parent so no stray folder leaks.
	if (!options.dryRun) {
		const parent = join(repoPath, WORK_ROOT, migration.fromFolder);
		try {
			rmdirSync(parent);
		} catch {
			// still has (untracked) content — leave it for the leak scan to surface.
		}
	}
	return moves;
}

// ───────────────────────────────────────────────────────────────────────────
// Layer 3b: the item CONTENT rewrite (frontmatter + inert refs, incl. done/).
// ───────────────────────────────────────────────────────────────────────────

/** One item file whose content the rewrite changed (or would change). */
export interface ContentRewrite {
	/** Repo-relative path of the item file. */
	path: string;
}

/**
 * Which `work/` folders carry ITEMS whose bodies/frontmatter may reference the
 * retired word — the FULL set including terminal/history folders, because
 * done-items ARE converted (ADR §7e: a `done/` full of dangling `prd:` refs is a
 * broken repo, so determinism overrides the old "don't touch done" convenience).
 * Paths are repo-relative and walked recursively. `work/specs/*` is included so
 * items ALREADY moved by layer 3a (whose bodies may still say `work/prds/…`) are
 * swept too. `work/protocol/` is EXCLUDED — layer 2 owns it (verbatim contract
 * copies, not data). Each entry is a path UNDER `work/` (the `WORK_ROOT` prefix
 * is prepended by the walker).
 */
const ITEM_CONTENT_FOLDERS: readonly string[] = [
	'tasks/backlog',
	'tasks/ready',
	'tasks/done',
	'tasks/cancelled',
	// BOTH the post-move `specs/*` locations AND the pre-move `prds/*` locations
	// are walked: after a real (non-dry-run) migration the items live in `specs/*`
	// (layer 3a moved them first) and `prds/*` is empty; under `--dry-run` the
	// folders are NOT moved, so the items are still in `prds/*` — walking both makes
	// the content sweep (and its dry-run report) accurate in either order, and it
	// stays idempotent (an empty folder contributes nothing).
	'prds/proposed',
	'prds/ready',
	'prds/tasked',
	'prds/dropped',
	'specs/proposed',
	'specs/ready',
	'specs/tasked',
	'specs/dropped',
	'notes/observations',
	'notes/ideas',
	'notes/findings',
	'questions',
];

/**
 * Recursively collect every `.md` file under a `work/`-relative folder (the entry
 * is UNDER `work/` — e.g. `'tasks/done'` — and `WORK_ROOT` is prepended here).
 * Returns repo-relative paths WITH the `work/` prefix.
 */
function collectMarkdown(repoPath: string, folderUnderWork: string): string[] {
	return collectMarkdownRel(repoPath, `${WORK_ROOT}/${folderUnderWork}`);
}

/** Recursively collect every `.md` file under a repo-relative folder path. */
function collectMarkdownRel(repoPath: string, folderRel: string): string[] {
	const abs = join(repoPath, folderRel);
	if (!existsSync(abs)) {
		return [];
	}
	const out: string[] = [];
	for (const entry of readdirSync(abs, {withFileTypes: true})) {
		const childRel = `${folderRel}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...collectMarkdownRel(repoPath, childRel));
		} else if (entry.name.toLowerCase().endsWith('.md')) {
			out.push(childRel);
		}
	}
	return out;
}

/**
 * Rewrite the retired word in ONE item's text, SCOPED to genuine STRUCTURAL
 * refs so it never corrupts prose or an immutable provenance SLUG (a landed
 * item's `slug: prd-to-spec-…` must survive verbatim — a slug can never be
 * renamed):
 *
 *   - the `prd:` frontmatter KEY at line start (`prdAfter:` too), NOT a `prd`
 *     inside a value/slug;
 *   - `work/prds/…` folder paths and a bare `prds/` folder segment;
 *   - `work/prd-<slug>` branch refs (the `work/` prefix makes it unambiguous —
 *     a bare `prd-<slug>` is NOT rewritten because it is indistinguishable from
 *     a provenance slug fragment; a genuine bare lock entry lives on a git ref,
 *     which {@link migrateRefs} handles, not in an item body);
 *   - `prd:<slug>` CLI-arg tokens (a `prd:` at a non-word boundary followed by a
 *     slug char), NOT a `prd:` embedded in a longer word.
 *
 * Returns the new text (unchanged when nothing matched). PURE — no IO — so it is
 * trivially testable and the caller decides whether to write. Exported for reuse
 * + the fixture test's determinism assertion.
 */
export function migrateItemContent(
	text: string,
	migration: VocabularyMigration = MIGRATION,
): string {
	const from = migration.from;
	let out = text;

	// (i) The frontmatter FIELD key on its own line: `prd:` → `spec:` (keep-case),
	//     matched at line start (optionally indented) so only the KEY is rewritten,
	//     never a `prd` inside a value/slug. Also `prdAfter:` if it ever appears.
	out = out.replace(
		new RegExp(`^(\\s*)(${from})(After)?(\\s*:)`, gimFlags()),
		(
			_m,
			indent: string,
			word: string,
			after: string | undefined,
			colon: string,
		) =>
			indent +
			keepCaseReplace(word, from, migration.to) +
			(after ?? '') +
			colon,
	);

	// (ii) Folder-path refs `work/prds/…` → `work/specs/…` (keep-case on the
	//      plural segment). A whole-path token, so a bare `prds/` inside a longer
	//      path is caught by the segment replace below too.
	out = replaceToken(
		out,
		`${WORK_ROOT}/${migration.fromFolder}`,
		`${WORK_ROOT}/${migration.toFolder}`,
	);
	out = replaceToken(out, `${migration.fromFolder}/`, `${migration.toFolder}/`);

	// (iii) Inert `work/<from>-<slug>` branch refs: the `work/` prefix makes this
	//       unambiguous (never a provenance-slug fragment), so a keep-case prefix
	//       replace is safe. A BARE `<from>-<slug>` is deliberately NOT rewritten
	//       (it is indistinguishable from a slug like `prd-to-spec-…`); a genuine
	//       bare lock entry lives on a git ref (`migrateRefs`), not an item body.
	out = replaceToken(
		out,
		`${WORK_ROOT}/${from}-`,
		`${WORK_ROOT}/${migration.to}-`,
	);

	// (iv) `<from>:<slug>` CLI-arg tokens (`prd:my-feature`): only at a non-word
	//      boundary followed by a slug char, so a `prd:` mid-word is untouched and
	//      the frontmatter KEY (line-start, handled by (i)) is not double-hit.
	out = out.replace(
		new RegExp(`(^|[^A-Za-z0-9_])(${from})(:[A-Za-z0-9])`, gimFlags()),
		(_m, pre: string, word: string, tail: string) =>
			pre + keepCaseReplace(word, from, migration.to) + tail,
	);

	return out;
}

/** Case-insensitive, multiline, global regex flags. */
function gimFlags(): string {
	return 'gim';
}

/**
 * Keep-case replace a fixed TOKEN wherever it appears (all three case variants),
 * a thin wrapper over {@link keepCaseReplace} scoped to a specific substring so
 * the intent (rewrite THIS token) is explicit at the call site.
 */
function replaceToken(text: string, from: string, to: string): string {
	return keepCaseReplace(text, from, to);
}

/**
 * Rewrite the retired word across EVERY item in the data folders (incl.
 * `done/`/`tasked/` — determinism). Writes each changed file in place (unless
 * `dryRun`), returning the list of files that changed. Idempotent: a file
 * already in the `spec` shape produces identical text and is not listed.
 */
export function migrateAllItemContent(
	repoPath: string,
	migration: VocabularyMigration = MIGRATION,
	options: {dryRun?: boolean} = {},
): ContentRewrite[] {
	const changed: ContentRewrite[] = [];
	for (const folder of ITEM_CONTENT_FOLDERS) {
		for (const rel of collectMarkdown(repoPath, folder)) {
			const abs = join(repoPath, rel);
			const before = readFileSync(abs, 'utf8');
			const after = migrateItemContent(before, migration);
			if (after !== before) {
				changed.push({path: rel});
				if (!options.dryRun) {
					writeFileSync(abs, after);
				}
			}
		}
	}
	return changed;
}

// ───────────────────────────────────────────────────────────────────────────
// Layer 3c: the CONFIG key rewrite (dorfl.json).
// ───────────────────────────────────────────────────────────────────────────

/** One config key the rewrite renamed (or would rename). */
export interface ConfigRewrite {
	from: string;
	to: string;
}

/**
 * Rewrite the retired config KEYS in `dorfl.json` (`prdsLandIn → specsLandIn`),
 * preserving each key's VALUE and the file's surrounding formatting — a TEXTUAL
 * key rename on the raw JSON, NOT a parse+reserialise (which would drop unknown
 * keys / reflow the file). Only renames a key that is actually present, so it is
 * idempotent (a config already on `specsLandIn` changes nothing) and safe on a
 * repo with no `dorfl.json`. Returns the keys renamed. `dryRun` reports without
 * writing.
 */
export function migrateConfig(
	repoPath: string,
	migration: VocabularyMigration = MIGRATION,
	options: {dryRun?: boolean} = {},
): ConfigRewrite[] {
	// Resolve the repo's actual config file (prefers `dorfl.json`, falls back to
	// the legacy `dorfl.json`), so the key rewrite finds it under either name.
	const configAbs = repoConfigPath(repoPath);
	if (!existsSync(configAbs)) {
		return [];
	}
	const before = readFileSync(configAbs, 'utf8');
	let after = before;
	const renamed: ConfigRewrite[] = [];
	for (const {from, to} of migration.configKeys) {
		// Match the quoted JSON key exactly: `"prdsLandIn"` → `"specsLandIn"`.
		const needle = `"${from}"`;
		if (after.includes(needle)) {
			after = after.split(needle).join(`"${to}"`);
			renamed.push({from, to});
		}
	}
	if (after !== before && !options.dryRun) {
		writeFileSync(configAbs, after);
	}
	return renamed;
}

// ───────────────────────────────────────────────────────────────────────────
// Layer 3d: the inert git-ref rename (lock refs + work-branches).
// ───────────────────────────────────────────────────────────────────────────

/** One git ref the rename relocated (or would relocate). */
export interface RefRename {
	from: string;
	to: string;
}

/**
 * Rename INERT local git refs carrying the retired word: per-item lock refs
 * `refs/dorfl/lock/<from>-<slug>` → `…/<to>-<slug>` and work-branches
 * `refs/heads/work/<from>-<slug>` → `…/work/<to>-<slug>`. The {@link
 * checkQuiescence} gate guarantees NO lock is held and NO in-flight branch
 * exists, so every ref reaching here is inert (a leftover created before the
 * cutover) and a plain rename is safe. Uses `git update-ref` for lock refs (they
 * are not branches) and `git branch -m` for work-branches. Idempotent: a ref
 * already on the `<to>-` spelling is left alone; `dryRun` reports without
 * touching refs.
 */
export function migrateRefs(
	repoPath: string,
	migration: VocabularyMigration = MIGRATION,
	options: {dryRun?: boolean; env?: NodeJS.ProcessEnv} = {},
): RefRename[] {
	const env = options.env;
	const renames: RefRename[] = [];

	// Lock refs: `refs/dorfl/lock/<from>-<slug>` → `refs/dorfl/lock/<to>-<slug>`.
	const lockPrefix = 'refs/dorfl/lock/';
	const locks = run(
		'git',
		['for-each-ref', '--format=%(refname) %(objectname)', lockPrefix],
		repoPath,
		{env},
	);
	if (locks.status === 0) {
		for (const line of locks.stdout.split('\n')) {
			const trimmed = line.trim();
			if (trimmed === '') continue;
			const [ref, sha] = trimmed.split(/\s+/);
			const entry = ref.slice(lockPrefix.length);
			if (!entry.startsWith(`${migration.from}-`)) continue;
			const newEntry = migration.to + entry.slice(migration.from.length);
			const newRef = lockPrefix + newEntry;
			renames.push({from: ref, to: newRef});
			if (!options.dryRun) {
				git(['update-ref', newRef, sha], repoPath, {env});
				git(['update-ref', '-d', ref], repoPath, {env});
			}
		}
	}

	// Work-branches: `work/<from>-<slug>` → `work/<to>-<slug>`.
	const branchPrefix = `${WORK_ROOT}/${migration.from}-`;
	const branches = run(
		'git',
		[
			'for-each-ref',
			'--format=%(refname:short)',
			`refs/heads/${branchPrefix}*`,
		],
		repoPath,
		{env},
	);
	if (branches.status === 0) {
		for (const line of branches.stdout.split('\n')) {
			const branch = line.trim();
			if (branch === '' || !branch.startsWith(branchPrefix)) continue;
			const newBranch = `${WORK_ROOT}/${migration.to}-${branch.slice(
				branchPrefix.length,
			)}`;
			renames.push({
				from: `refs/heads/${branch}`,
				to: `refs/heads/${newBranch}`,
			});
			if (!options.dryRun) {
				git(['branch', '-m', branch, newBranch], repoPath, {env});
			}
		}
	}

	return renames;
}

// ───────────────────────────────────────────────────────────────────────────
// The leak scan (the acceptance GATE over the CONVERTED data tree).
// ───────────────────────────────────────────────────────────────────────────

/** One leak the data-tree scan found (a survivor of the retired word). */
export interface DataLeak {
	/** Repo-relative file (or ref) the leak lives in. */
	where: string;
	/** The offending token/line. */
	token: string;
	/** Which lens flagged it. */
	lens: 'forward' | 'reverse';
	/** A one-line explanation. */
	why: string;
}

/**
 * The DATA-tree forward+reverse leak scan — the acceptance GATE for the
 * command's OUTPUT (ADR §7e: the leak scan is exhaustive-by-construction). This
 * is the DATA analogue of the source-part `prd-to-spec-leak-scan.test.ts`
 * (which scans `src/`/`skills/`/`docs/`): here it walks the CONVERTED `work/`
 * tree + `dorfl.json` + the git refs.
 *
 *   - **FORWARD:** fails on any surviving retired word (`prd`/`Prd`/`PRD`) in a
 *     data STRUCTURE position — a frontmatter `prd:` KEY, a `work/prds/…` folder
 *     path, a `work/prd-<slug>` branch ref, a `prd-<slug>` lock entry, a config
 *     key `prdsLandIn`, or a `prd:<slug>` token. It deliberately IGNORES the
 *     retired word in running PROSE (a body sentence, an immutable provenance
 *     slug like `prd-to-spec-…`) — those are the artifact word in narrative, not
 *     a dangling structural ref, exactly as the source-part scan's option-A cut.
 *   - **REVERSE:** fails on genuine English CORRUPTED by a blind keep-case sweep
 *     (`espec…`→`esspec…`-style mangles) — the guard that `spec`'s English
 *     collisions were not mangled.
 *
 * A green scan on the converted fixture is the proof the four layers left no
 * dangling structural `prd`. Returns every leak (empty ⇒ green).
 */
export function scanForLeaks(
	repoPath: string,
	migration: VocabularyMigration = MIGRATION,
	env: NodeJS.ProcessEnv | undefined = undefined,
): DataLeak[] {
	const leaks: DataLeak[] = [];
	const from = migration.from;

	// STRUCTURAL forward patterns: a surviving retired word in a data position.
	const structural: ReadonlyArray<{pattern: RegExp; why: string}> = [
		{
			pattern: new RegExp(`^\\s*${from}(After)?\\s*:`, 'i'),
			why: `surviving '${from}:' frontmatter key`,
		},
		{
			pattern: new RegExp(`${WORK_ROOT}/${migration.fromFolder}(/|\\b)`, 'i'),
			why: `surviving '${WORK_ROOT}/${migration.fromFolder}/' folder path`,
		},
		{
			// A bare `prds/` folder ref, but ONLY a real on-disk path shape:
			// lowercase `prds/` followed by a lifecycle subfolder. Deliberately NO
			// `'i'` flag + a required lifecycle segment, so a prose acronym-plural
			// like `slices/PRDs/code` or `PRDs/ADRs` (the artifact word `PRDs` + `/`
			// + another word) is NOT mis-flagged as a folder ref (the option-A prose
			// exemption). The `${WORK_ROOT}/${fromFolder}` pattern above still
			// catches a rooted `work/prds/...` path case-insensitively as the backstop.
			pattern: new RegExp(
				`\\b${migration.fromFolder}/(proposed|ready|tasked|dropped)\\b`,
			),
			why: `surviving '${migration.fromFolder}/' folder ref`,
		},
		{
			pattern: new RegExp(`${WORK_ROOT}/${from}-`, 'i'),
			why: `surviving '${WORK_ROOT}/${from}-' branch ref`,
		},
		{
			pattern: new RegExp(`(^|[^A-Za-z])${from}:[A-Za-z0-9]`, 'i'),
			why: `surviving '${from}:<slug>' arg`,
		},
	];
	// Config-key survivors (the exact keys the config layer renames).
	const configKeyPatterns = migration.configKeys.map(({from: key}) => ({
		pattern: new RegExp(`"${key}"`),
		why: `surviving '${key}' config key`,
	}));

	// Corrupted-English (reverse) shapes a blind sweep would have produced.
	const corrupted: ReadonlyArray<{pattern: RegExp; why: string}> = [
		{pattern: /esspec/i, why: 'especially → esspec… (mangle)'},
		{pattern: /speccif/i, why: 'specify/specific → speccif… (mangle)'},
		{pattern: /inspecc/i, why: 'inspect → inspecc… (mangle)'},
		{pattern: /respecc/i, why: 'respect → respecc… (mangle)'},
	];

	const scanText = (
		where: string,
		text: string,
		keyPatterns: typeof configKeyPatterns,
	) => {
		const lines = text.split('\n');
		lines.forEach((line, idx) => {
			for (const {pattern, why} of structural) {
				const m = pattern.exec(line);
				if (m) {
					leaks.push({
						where: `${where}:${idx + 1}`,
						token: m[0],
						lens: 'forward',
						why,
					});
				}
			}
			for (const {pattern, why} of keyPatterns) {
				const m = pattern.exec(line);
				if (m) {
					leaks.push({
						where: `${where}:${idx + 1}`,
						token: m[0],
						lens: 'forward',
						why,
					});
				}
			}
			for (const {pattern, why} of corrupted) {
				const m = pattern.exec(line);
				if (m) {
					leaks.push({
						where: `${where}:${idx + 1}`,
						token: m[0],
						lens: 'reverse',
						why,
					});
				}
			}
		});
	};

	// Walk every converted data item (the FULL folder set, incl. done/tasked).
	for (const folder of ITEM_CONTENT_FOLDERS) {
		for (const rel of collectMarkdown(repoPath, folder)) {
			scanText(rel, readFileSync(join(repoPath, rel), 'utf8'), []);
		}
	}
	// The config file (the key layer) — under either the preferred `dorfl.json`
	// or the legacy `dorfl.json`.
	const configAbs = repoConfigPath(repoPath);
	if (existsSync(configAbs)) {
		scanText(
			basename(configAbs),
			readFileSync(configAbs, 'utf8'),
			configKeyPatterns,
		);
	}
	// The FOLDER TREE itself: a surviving `work/prds/` directory (empty ⇒ no
	// file, but the folder still leaks). Report it structurally.
	const strayFolder = join(repoPath, WORK_ROOT, migration.fromFolder);
	if (existsSync(strayFolder)) {
		leaks.push({
			where: `${WORK_ROOT}/${migration.fromFolder}`,
			token: `${WORK_ROOT}/${migration.fromFolder}`,
			lens: 'forward',
			why: `surviving '${WORK_ROOT}/${migration.fromFolder}/' folder`,
		});
	}
	// The git refs (lock refs + branches carrying the retired word).
	for (const spec of [
		{
			args: ['for-each-ref', '--format=%(refname)', 'refs/dorfl/lock/'],
			where: 'refs/dorfl/lock',
		},
		{
			args: [
				'for-each-ref',
				'--format=%(refname:short)',
				`refs/heads/${WORK_ROOT}/`,
			],
			where: 'refs/heads',
		},
	]) {
		const res = run('git', spec.args, repoPath, {env});
		if (res.status !== 0) continue;
		for (const line of res.stdout.split('\n')) {
			const ref = line.trim();
			if (ref === '') continue;
			if (
				new RegExp(`(^|/)${from}-`, 'i').test(ref) ||
				new RegExp(`/${from}-`, 'i').test(ref)
			) {
				leaks.push({
					where: spec.where,
					token: ref,
					lens: 'forward',
					why: `surviving '${from}-' git ref`,
				});
			}
		}
	}

	return leaks;
}

// ───────────────────────────────────────────────────────────────────────────
// The orchestrator (the thin CLI shell drives THIS).
// ───────────────────────────────────────────────────────────────────────────

/** Options for {@link runPrdToSpec}. */
export interface PrdToSpecOptions {
	/** The repo working-tree root to migrate (the in-place downstream/fixture). */
	repoPath: string;
	/** Report what WOULD change across all layers, touching nothing. */
	dryRun?: boolean;
	/** The vocabulary cutover (defaults to the `prd → spec` {@link MIGRATION}). */
	migration?: VocabularyMigration;
	env?: NodeJS.ProcessEnv;
}

/** What the migration did (or, under dry-run, would do). */
export interface PrdToSpecResult {
	/** Set when the quiescence gate REFUSED — no layer ran. */
	refused?: QuiescenceViolation;
	/** True when this run was a dry-run (nothing was written). */
	dryRun: boolean;
	resync?: ResyncResult;
	folderMoves: FolderMove[];
	contentRewrites: ContentRewrite[];
	configRewrites: ConfigRewrite[];
	refRenames: RefRename[];
	/** Leaks found by the post-migration scan (empty ⇒ green). Skipped on refuse. */
	leaks: DataLeak[];
}

/**
 * Run the self-contained `prd → spec` migration end-to-end (ADR §7e, decision
 * B): quiescence gate → setup re-sync → four-layer data migration → leak scan.
 * On a quiescence violation it REFUSES (returns `{refused}`, runs no layer). The
 * thin `dorfl prd-to-spec` CLI shell formats this result; the fixture test
 * asserts each field. `dryRun` threads through every layer.
 */
export function runPrdToSpec(options: PrdToSpecOptions): PrdToSpecResult {
	const {repoPath} = options;
	const migration = options.migration ?? MIGRATION;
	const dryRun = options.dryRun === true;
	const env = options.env;

	const refused = checkQuiescence(repoPath, migration, env);
	if (refused) {
		return {
			refused,
			dryRun,
			folderMoves: [],
			contentRewrites: [],
			configRewrites: [],
			refRenames: [],
			leaks: [],
		};
	}

	// 2. Setup contract re-sync FIRST (decision B).
	const resync = resyncProtocol(repoPath, {
		dryRun,
		sourceCommit: 'dorfl prd-to-spec',
	});
	// 3a. Folders (git mv) — before content, so the content sweep also fixes the
	//     moved items' own `work/prds/…` body refs in their NEW location.
	const folderMoves = migrateFolders(repoPath, migration, {dryRun});
	// 3b. Item content (frontmatter + inert refs) across ALL items incl. done/.
	const contentRewrites = migrateAllItemContent(repoPath, migration, {dryRun});
	// 3c. Config key rename.
	const configRewrites = migrateConfig(repoPath, migration, {dryRun});
	// 3d. Inert git refs (lock refs + work-branches).
	const refRenames = migrateRefs(repoPath, migration, {dryRun, env});

	// The acceptance GATE over the converted tree (skipped under dry-run, where
	// nothing was written so the tree still carries the pre-migration data).
	const leaks = dryRun ? [] : scanForLeaks(repoPath, migration, env);

	return {
		dryRun,
		resync,
		folderMoves,
		contentRewrites,
		configRewrites,
		refRenames,
		leaks,
	};
}
