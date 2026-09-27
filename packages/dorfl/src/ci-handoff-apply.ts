/**
 * **The apply phase's validation of a handoff** (spec
 * `ci-agent-job-without-write-token`, ADR `ci-agent-job-holds-no-write-token`
 * decisions 3 and 4, task `ci-split-apply-rejects-hostile-bundle`).
 *
 * The apply job holds a write token and runs no agent. It reads the agent job's
 * artifact as HOSTILE: every target, mode and policy comes from TRUSTED inputs
 * (the lock job's outputs, the workflow inputs, the tree at `baseSha`, the
 * arbiter), never from the artifact. {@link validateApplyHandoff} is the one
 * unit the path splits call BEFORE any write. It either returns the validated
 * handoff (the bundle's tip fetched to {@link INCOMING_TIP_REF} in the apply
 * checkout, the recomputed integration mode, the ledger report) or throws a
 * {@link HandoffRejected} whose `rule` and message name the broken rule, having
 * written nothing from the artifact anywhere: not to the arbiter, and not even
 * into the apply checkout's object store.
 *
 * How "nothing is fetched into the repository" holds: the bundle is first
 * fetched into a throwaway QUARANTINE repository whose object store borrows the
 * apply checkout's objects (read-only, through `objects/info/alternates`), and
 * every history, path and size check runs there. Only an accepted bundle is
 * then fetched into the apply checkout, with the same command.
 *
 * Out of scope here: LFS objects (task `ci-split-handoff-lfs-objects`), and the
 * agent-result, lock-ownership and re-run rules (wired by the path splits).
 */

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join, posix} from 'node:path';
import type {IntegrationMode} from './config.js';
import {
	handoffByteLimits,
	rejectHandoff as reject,
	type HandoffRung,
} from './ci-handoff-format.js';
import {readHandoff, type ReadHandoff} from './ci-handoff.js';
import {parseFrontmatter} from './frontmatter.js';
import {git, run} from './git.js';
import {APPLY_LIFECYCLE_FOLDERS} from './item-path.js';
import {
	REPO_CONFIG_FILENAME,
	REPO_CONFIG_FILENAME_LEGACY,
} from './repo-config.js';
import {resolveSidecarIdentity} from './sidecar.js';
import {workBranchRef} from './slug-namespace.js';
import {WORK_ROOT, workFolderPrefix, workItemRel} from './work-layout.js';

/** The apply checkout's ref an accepted bundle's tip is fetched to. */
export const INCOMING_TIP_REF = 'refs/dorfl/incoming/tip';

/** The most new commits (`tip ^<arbiter>/main`) a bundle may carry. */
export const MAX_NEW_COMMITS = 200;

/** The reason for a merge commit in the range (spec, "History"). */
export const MERGE_COMMIT_REASON =
	'the work branch contains a merge commit; rebase it and requeue';

/** The longest symlink target read (Linux `PATH_MAX`); longer is rejected. */
const MAX_SYMLINK_TARGET_BYTES = 4096;
/** How many symlinks one resolution may follow before it counts as a loop. */
const MAX_SYMLINK_HOPS = 40;
/** How many ledger paths the PR-body section lists before "and N more". */
const LEDGER_REPORT_MAX_PATHS = 100;

const HEX_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MODE_SYMLINK = '120000';
const MODE_GITLINK = '160000';

// ---------------------------------------------------------------------------
// Protected paths (decision 3)
// ---------------------------------------------------------------------------

/**
 * The protected path rule a repository path falls under, or `undefined`. The
 * fixed built-in list of decision 3 (not a config key): `.github/`,
 * `CODEOWNERS` (root, `docs/`, `.github/`), the repository config (`dorfl.json`
 * and its legacy dotfile, which dorfl still reads), `.lfsconfig`, and
 * `.gitattributes` at ANY depth (a nested one sets merge attributes for its
 * subtree just like the root one). Matched case-insensitively, so a
 * `.GitHub/` that a case-insensitive checkout would fold into `.github/` is
 * caught too.
 */
export function protectedPathOf(path: string): string | undefined {
	const p = path.toLowerCase();
	if (p === '.github' || p.startsWith('.github/')) return '.github/';
	if (p === 'codeowners' || p === 'docs/codeowners') return 'CODEOWNERS';
	if (
		p === REPO_CONFIG_FILENAME.toLowerCase() ||
		p === REPO_CONFIG_FILENAME_LEGACY.toLowerCase()
	) {
		return REPO_CONFIG_FILENAME;
	}
	if (p === '.lfsconfig') return '.lfsconfig';
	if (p === '.gitattributes' || p.endsWith('/.gitattributes')) {
		return '.gitattributes';
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Inputs and result
// ---------------------------------------------------------------------------

/** The trusted facts the apply job validates a handoff against. */
export interface ApplyTrust {
	/** The item this run carries (lock output / workflow input). */
	item: string;
	/** The rung the lock job classified. */
	rung: HandoffRung;
	/** The arbiter's `main` the lock job classified the item at. */
	baseSha: string;
	/** The arbiter git remote of the apply checkout. */
	arbiter: string;
	/** The integration mode the workflow asked for (before the recomputed rules). */
	integrationMode: IntegrationMode;
}

/** A handoff that passed every rule. */
export interface ApplyHandoff {
	handoff: ReadHandoff;
	/**
	 * The integration mode to land with: `merge` only when the trusted
	 * `integrationMode` is `merge` AND the untrusted-origin rule, recomputed from
	 * the task at `baseSha`, does not force `propose`.
	 */
	mode: IntegrationMode;
	/** Whether the untrusted-origin rule turned a trusted `merge` into `propose`. */
	forcedPropose: boolean;
	/** The accepted bundle, when the handoff carries one. */
	bundle?: {
		/** The work branch name (`workBranchRef` of the trusted item). */
		workBranch: string;
		/** The validated tip, now at {@link INCOMING_TIP_REF} in the apply checkout. */
		tip: string;
		/** The new commits (`tip ^<arbiter>/main`), newest first. */
		newCommits: string[];
	};
	/** `work/` paths the bundle changes outside this item's own transition (propose only). */
	ledgerOutsideItem: string[];
	/** The PR-body section listing {@link ledgerOutsideItem}, when there are any. */
	ledgerReport?: string;
}

// ---------------------------------------------------------------------------
// The recomputed policy
// ---------------------------------------------------------------------------

/**
 * The untrusted-origin build-propose rule (ADR `untrusted-origin-build-checkpoint`,
 * `integration-core.ts`), recomputed from the task AT `baseSha` in the apply
 * checkout, never from the bundle (whose done-move could strip the stamp).
 * Scope as in `performIntegration`: the task BUILD transition only; CI passes
 * no explicit `--merge`, so there is no override. Any copy of the task at
 * `baseSha` stamped `originTrust: untrusted` forces `propose`.
 */
export function recomputeIntegrationMode(params: {
	repo: string;
	baseSha: string;
	item: string;
	integrationMode: IntegrationMode;
	/** Whether the handoff is a task build (`integrate` on the build rung). */
	build: boolean;
	env?: NodeJS.ProcessEnv;
}): {mode: IntegrationMode; forcedPropose: boolean} {
	const {repo, baseSha, integrationMode, build, env} = params;
	if (integrationMode !== 'merge' || !build) {
		return {mode: integrationMode, forcedPropose: false};
	}
	const {type, slug} = resolveSidecarIdentity(params.item);
	if (type !== 'task') return {mode: 'merge', forcedPropose: false};
	for (const folder of APPLY_LIFECYCLE_FOLDERS.task) {
		const spec = `${baseSha}:${workItemRel(folder, `${slug}.md`)}`;
		const r = run('git', ['cat-file', 'blob', spec], repo, {env});
		if (r.status !== 0) continue;
		if (parseFrontmatter(r.stdout).originTrust === 'untrusted') {
			return {mode: 'propose', forcedPropose: true};
		}
	}
	return {mode: 'merge', forcedPropose: false};
}

// ---------------------------------------------------------------------------
// The ledger report
// ---------------------------------------------------------------------------

/**
 * The PR-body section that lists the `work/` paths a propose-mode bundle
 * changes outside its own item (decision 3, user story 23). The path names come
 * from the hostile bundle, so each is JSON-quoted inside a code fence longer
 * than any backtick run, which keeps a crafted name from closing the fence or
 * starting a heading; the list is bounded.
 */
export function renderLedgerReportSection(paths: readonly string[]): string {
	const shown = paths
		.slice(0, LEDGER_REPORT_MAX_PATHS)
		.map((p) => JSON.stringify(p.slice(0, 500)));
	const body = shown.join('\n');
	const longestRun = Math.max(
		0,
		...(body.match(/`+/g) ?? []).map((r) => r.length),
	);
	const fence = '`'.repeat(Math.max(3, longestRun + 1));
	const more =
		paths.length > shown.length
			? `\n\nand ${paths.length - shown.length} more.`
			: '';
	return (
		'### Ledger changes outside this item\n\n' +
		'The work branch changes these files under `work/`, which are not part of ' +
		"this item's own transition, a new note or a new ADR. Check them before " +
		'merging.\n\n' +
		`${fence}text\n${body}\n${fence}${more}\n`
	);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** One `git diff-tree -r -z --raw` entry. */
interface RawChange {
	oldMode: string;
	newMode: string;
	newOid: string;
	status: string;
	path: string;
}

function parseRawZ(out: string): RawChange[] {
	const fields = out.split('\0');
	const changes: RawChange[] = [];
	for (let i = 0; i + 1 < fields.length; i += 2) {
		const meta = fields[i];
		if (!meta.startsWith(':')) break;
		const [oldMode, newMode, , newOid, status] = meta.slice(1).split(' ');
		changes.push({oldMode, newMode, newOid, status, path: fields[i + 1]});
	}
	return changes;
}

function diffTree(
	cwd: string,
	from: string,
	to: string,
	env?: NodeJS.ProcessEnv,
): RawChange[] {
	return parseRawZ(
		git(
			[
				'-c',
				'diff.renames=false',
				'diff-tree',
				'-r',
				'-z',
				'--raw',
				'--no-renames',
				'--no-commit-id',
				from,
				to,
			],
			cwd,
			{env},
		),
	);
}

function short(sha: string): string {
	return sha.slice(0, 12);
}

/** Quote a hostile path for a rejection message. */
function q(path: string): string {
	return JSON.stringify(path.slice(0, 300));
}

// ---------------------------------------------------------------------------
// Symlinks
// ---------------------------------------------------------------------------

/**
 * Resolve `path`'s target through the commit's own symlinks, component by
 * component, and say whether it stays inside the repository (and out of
 * `.git`). Lexical normalisation alone is not enough: `d -> .` and
 * `a -> d/..` are each inside on their own, but `a` resolves to the parent.
 */
function symlinkEscapes(
	path: string,
	symlinks: ReadonlyMap<string, string>,
): boolean {
	const stack: string[] = [];
	const initial = symlinks.get(path);
	if (initial === undefined || initial === '' || initial.includes('\0')) {
		return true;
	}
	if (initial.startsWith('/')) return true;
	let queue = [...posix.dirname(path).split('/'), ...initial.split('/')];
	let hops = 0;
	while (queue.length > 0) {
		const c = queue.shift() as string;
		if (c === '' || c === '.') continue;
		if (c === '..') {
			if (stack.length === 0) return true;
			stack.pop();
			continue;
		}
		stack.push(c);
		const target = symlinks.get(stack.join('/'));
		if (target !== undefined) {
			if (++hops > MAX_SYMLINK_HOPS) return true;
			if (target === '' || target.startsWith('/')) return true;
			stack.pop();
			queue = [...target.split('/'), ...queue];
		}
	}
	return stack.length > 0 && stack[0].toLowerCase() === '.git';
}

/** Every symlink of `commit`'s tree with its target (sizes bounded first). */
function treeSymlinks(
	cwd: string,
	commit: string,
	env?: NodeJS.ProcessEnv,
): Map<string, string> {
	const entries = git(['ls-tree', '-r', '-z', commit], cwd, {env}).split('\0');
	const links = new Map<string, string>();
	for (const entry of entries) {
		if (!entry.startsWith(`${MODE_SYMLINK} `)) continue;
		const tab = entry.indexOf('\t');
		const oid = entry.slice(0, tab).split(' ')[2];
		const path = entry.slice(tab + 1);
		const size = Number(git(['cat-file', '-s', oid], cwd, {env}).trim());
		if (size > MAX_SYMLINK_TARGET_BYTES) {
			reject(
				'symlink-target',
				`the symlink ${q(path)} has an oversized target`,
			);
		}
		links.set(path, git(['cat-file', 'blob', oid], cwd, {env}));
	}
	return links;
}

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

interface BundleCheck {
	quarantine: string;
	bundlePath: string;
	workBranch: string;
	baseSha: string;
	mainSha: string;
	ownItemPaths: ReadonlySet<string>;
	env?: NodeJS.ProcessEnv;
}

/** Fetch the bundle's one expected ref, with fsck, into `cwd`'s incoming ref. */
function fetchBundle(
	cwd: string,
	bundlePath: string,
	workBranch: string,
	env?: NodeJS.ProcessEnv,
): {status: number; stderr: string} {
	run('git', ['update-ref', '-d', INCOMING_TIP_REF], cwd, {env});
	return run(
		'git',
		[
			'-c',
			'transfer.fsckObjects=true',
			'fetch',
			'--quiet',
			'--no-tags',
			'--no-write-fetch-head',
			bundlePath,
			`refs/heads/${workBranch}:${INCOMING_TIP_REF}`,
		],
		cwd,
		{env},
	);
}

/**
 * Run every history, path and size rule over the bundle inside the quarantine;
 * return the tip, the new commits and the ledger paths outside the item.
 */
function checkBundle(c: BundleCheck): {
	tip: string;
	newCommits: string[];
	ledgerOutside: string[];
} {
	const {quarantine: qdir, env} = c;
	const fetched = fetchBundle(qdir, c.bundlePath, c.workBranch, env);
	if (fetched.status !== 0) {
		reject(
			'bundle-format',
			`the bundle could not be fetched (fsck or format): ${fetched.stderr.trim().slice(0, 500)}`,
		);
	}
	const tip = git(['rev-parse', INCOMING_TIP_REF], qdir, {env}).trim();

	// History: descends from baseSha, bounded, linear.
	if (
		run('git', ['merge-base', '--is-ancestor', c.baseSha, tip], qdir, {env})
			.status !== 0
	) {
		reject(
			'history',
			`the work branch tip ${short(tip)} does not descend from the base ${c.baseSha}`,
		);
	}
	const count = Number(
		git(['rev-list', '--count', tip, `^${c.mainSha}`], qdir, {env}).trim(),
	);
	if (count === 0) {
		reject('history', 'the work branch has no new commit over main');
	}
	if (count > MAX_NEW_COMMITS) {
		reject(
			'commit-count',
			`the work branch has ${count} new commits, over the limit of ${MAX_NEW_COMMITS}`,
		);
	}
	const merges = git(
		['rev-list', '--min-parents=2', tip, `^${c.mainSha}`],
		qdir,
		{env},
	).trim();
	if (merges !== '') {
		reject('merge-commit', `${MERGE_COMMIT_REASON} (${short(merges)})`);
	}
	const newCommits = git(['rev-list', tip, `^${c.mainSha}`], qdir, {env})
		.trim()
		.split('\n');

	// Per commit, against its single parent: protected paths, gitlinks,
	// symlinks, blob sizes.
	const blobs = new Map<string, string>();
	let oldestParent = '';
	for (const commit of newCommits) {
		const parents = git(['rev-list', '--parents', '-n', '1', commit], qdir, {
			env,
		})
			.trim()
			.split(' ')
			.slice(1);
		if (parents.length !== 1) {
			reject('history', `the commit ${short(commit)} has no parent on main`);
		}
		oldestParent = parents[0];
		let touchesSymlink = false;
		for (const ch of diffTree(qdir, parents[0], commit, env)) {
			const rule = protectedPathOf(ch.path);
			if (rule !== undefined) {
				reject(
					'protected-path',
					`the commit ${short(commit)} changes the protected path ${q(ch.path)} ` +
						`(${rule}); CI never lands a change to a protected path, so ` +
						'build this task locally',
				);
			}
			if (ch.status === 'D') continue;
			if (ch.newMode === MODE_GITLINK) {
				reject(
					'gitlink',
					`the commit ${short(commit)} adds a gitlink (submodule) at ${q(ch.path)}`,
				);
			}
			if (ch.newMode === MODE_SYMLINK) touchesSymlink = true;
			blobs.set(ch.newOid, ch.path);
		}
		if (touchesSymlink) {
			const links = treeSymlinks(qdir, commit, env);
			for (const path of links.keys()) {
				if (symlinkEscapes(path, links)) {
					reject(
						'symlink-target',
						`the symlink ${q(path)} in commit ${short(commit)} points outside the repository`,
					);
				}
			}
		}
	}
	if (blobs.size > 0) {
		const maxBlob = handoffByteLimits().blobBytes;
		const sizes = git(
			['cat-file', '--batch-check=%(objectname) %(objectsize)'],
			qdir,
			{env, input: [...blobs.keys()].join('\n') + '\n'},
		)
			.trim()
			.split('\n');
		for (const line of sizes) {
			const [oid, size] = line.split(' ');
			if (Number(size) > maxBlob) {
				reject(
					'size',
					`the blob ${q(blobs.get(oid) ?? oid)} is ${size} bytes, over the limit of ${maxBlob}`,
				);
			}
		}
	}

	// The work/ ledger rule, on the net change of the new commits.
	const ledgerOutside: string[] = [];
	const notes = `${WORK_ROOT}/notes/`;
	for (const ch of diffTree(qdir, oldestParent, tip, env)) {
		if (!ch.path.startsWith(`${WORK_ROOT}/`)) continue;
		if (c.ownItemPaths.has(ch.path)) continue;
		const newNote =
			ch.path.startsWith(notes) &&
			ch.status === 'A' &&
			run('git', ['cat-file', '-e', `${c.mainSha}:${ch.path}`], qdir, {env})
				.status !== 0;
		if (!newNote) ledgerOutside.push(ch.path);
	}
	return {tip, newCommits, ledgerOutside};
}

/** The item's own ledger files: its body in every lifecycle folder of its type. */
function ownItemPaths(item: string): Set<string> {
	const {type, slug} = resolveSidecarIdentity(item);
	return new Set(
		APPLY_LIFECYCLE_FOLDERS[type].map(
			(f) => `${workFolderPrefix(f)}${slug}.md`,
		),
	);
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Validate the agent job's handoff before the apply job writes anything.
 *
 * `dir` is the downloaded artifact under `runnerTemp`; `repo` is the apply
 * job's own checkout of the trusted base, whose `trust.arbiter` remote is
 * fetched fresh here. The steps, each a rejection ({@link HandoffRejected})
 * naming its rule:
 *
 * 1. the artifact (`readHandoff`): layout, sizes, schema, `item` equal to the
 *    trusted item, an intent kind the trusted rung can produce;
 * 2. the bundle's one ref must be `refs/heads/<workBranchRef(type, slug)>` of
 *    the trusted item, and its prerequisites must exist in the apply checkout;
 * 3. in the quarantine: fetch that ref only, with `transfer.fsckObjects`;
 *    `baseSha` is an ancestor of the tip; the new set `tip ^<arbiter>/main` is
 *    non-empty, at most {@link MAX_NEW_COMMITS} and has no merge commit; per
 *    new commit, no protected path ({@link protectedPathOf}), no gitlink, no
 *    symlink resolving outside the repository, no blob over the limit;
 * 4. the `work/` ledger rule on the net change: only this item's own
 *    transition and new `work/notes/*` files (ADRs live outside `work/`);
 *    anything else is rejected in `merge` mode and reported in `propose` mode;
 * 5. only then the bundle is fetched into the apply checkout at
 *    {@link INCOMING_TIP_REF}.
 *
 * The integration mode is recomputed ({@link recomputeIntegrationMode}) before
 * the ledger rule, which depends on it.
 */
export function validateApplyHandoff(params: {
	dir: string;
	runnerTemp: string;
	repo: string;
	trust: ApplyTrust;
	env?: NodeJS.ProcessEnv;
}): ApplyHandoff {
	const {dir, runnerTemp, repo, trust, env} = params;
	if (!HEX_OID.test(trust.baseSha)) {
		reject('history', 'the trusted baseSha is not a full commit id');
	}
	const handoff = readHandoff({
		dir,
		runnerTemp,
		trust: {item: trust.item, rung: trust.rung},
	});
	const item = handoff.record.item;
	const {mode, forcedPropose} = recomputeIntegrationMode({
		repo,
		baseSha: trust.baseSha,
		item,
		integrationMode: trust.integrationMode,
		build: handoff.row.row === 'integrate-build',
		env,
	});
	if (handoff.bundle === undefined) {
		return {handoff, mode, forcedPropose, ledgerOutsideItem: []};
	}

	const {type, slug} = resolveSidecarIdentity(item);
	const workBranch = workBranchRef(type, slug);
	const expectedRef = `refs/heads/${workBranch}`;
	if (handoff.bundle.ref !== expectedRef) {
		reject(
			'bundle-refs',
			`the bundle carries ${q(handoff.bundle.ref)}, not ${expectedRef}`,
		);
	}

	// A fresh view of the arbiter's main (trusted; the apply job's own fetch).
	git(
		[
			'fetch',
			'--quiet',
			'--no-tags',
			trust.arbiter,
			`+refs/heads/main:refs/remotes/${trust.arbiter}/main`,
		],
		repo,
		{env},
	);
	const mainSha = git(
		['rev-parse', `refs/remotes/${trust.arbiter}/main^{commit}`],
		repo,
		{env},
	).trim();
	for (const pre of handoff.bundle.prerequisites) {
		if (
			run('git', ['cat-file', '-e', `${pre}^{commit}`], repo, {env}).status !==
			0
		) {
			reject(
				'history',
				`the bundle is based on ${pre}, a commit the arbiter does not have, ` +
					`not on the base ${trust.baseSha}`,
			);
		}
	}

	const quarantine = mkdtempSync(join(runnerTemp, 'dorfl-quarantine-'));
	let checked: ReturnType<typeof checkBundle>;
	try {
		const format = git(['rev-parse', '--show-object-format'], repo, {
			env,
		}).trim();
		git(
			['init', '--quiet', '--bare', `--object-format=${format}`, quarantine],
			repo,
			{env},
		);
		const objects = git(
			['rev-parse', '--path-format=absolute', '--git-path', 'objects'],
			repo,
			{env},
		).trim();
		writeFileSync(
			join(quarantine, 'objects', 'info', 'alternates'),
			`${objects}\n`,
		);
		checked = checkBundle({
			quarantine,
			bundlePath: handoff.bundle.path,
			workBranch,
			baseSha: trust.baseSha,
			mainSha,
			ownItemPaths: ownItemPaths(item),
			env,
		});
	} finally {
		rmSync(quarantine, {recursive: true, force: true});
	}

	if (mode === 'merge' && checked.ledgerOutside.length > 0) {
		reject(
			'ledger',
			'in merge mode the work branch may change under work/ only its own ' +
				'item, new notes and new ADRs, but it changes ' +
				checked.ledgerOutside.slice(0, 20).map(q).join(', '),
		);
	}

	const imported = fetchBundle(repo, handoff.bundle.path, workBranch, env);
	const landed =
		imported.status === 0
			? git(['rev-parse', INCOMING_TIP_REF], repo, {env}).trim()
			: '';
	if (landed !== checked.tip) {
		run('git', ['update-ref', '-d', INCOMING_TIP_REF], repo, {env});
		reject('bundle-format', 'the bundle changed between validation and import');
	}

	return {
		handoff,
		mode,
		forcedPropose,
		bundle: {workBranch, tip: checked.tip, newCommits: checked.newCommits},
		ledgerOutsideItem: checked.ledgerOutside,
		ledgerReport:
			checked.ledgerOutside.length > 0
				? renderLedgerReportSection(checked.ledgerOutside)
				: undefined,
	};
}
