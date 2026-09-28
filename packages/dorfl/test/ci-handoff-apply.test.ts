import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	symlinkSync,
	existsSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {
	HANDOFF_LIMITS,
	HandoffRejected,
	handoffByteLimits,
	setHandoffByteLimitsForTest,
	type HandoffRung,
} from '../src/ci-handoff-format.js';
import {HANDOFF_BUNDLE, HANDOFF_JSON} from '../src/ci-handoff.js';
import {
	INCOMING_TIP_REF,
	MAX_NEW_COMMITS,
	MERGE_COMMIT_REASON,
	protectedPathOf,
	renderLedgerReportSection,
	validateApplyHandoff,
	type ApplyTrust,
} from '../src/ci-handoff-apply.js';

/**
 * The apply phase reads the agent job's handoff as HOSTILE (task
 * `ci-split-apply-rejects-hostile-bundle`). Every hostile case runs against a
 * real bare arbiter, asserts the arbiter's refs are unchanged (a
 * `git for-each-ref` snapshot), that nothing from the artifact reached the apply
 * checkout, and that the rejection names the rule.
 */

function sh(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		stdio: ['pipe', 'pipe', 'pipe'],
	}).trim();
}

function write(repo: string, rel: string, content: string): void {
	mkdirSync(dirname(join(repo, rel)), {recursive: true});
	writeFileSync(join(repo, rel), content);
}

function commitAll(repo: string, message: string): string {
	sh(repo, 'add', '-A');
	sh(repo, 'commit', '-qm', message, '--allow-empty');
	return sh(repo, 'rev-parse', 'HEAD');
}

const TASK = `---
title: Add the thing
slug: add-thing
---

## What to build

The thing.
`;

const UNTRUSTED_TASK = `---
title: Add the thing
slug: add-thing
origin: issue
originTrust: untrusted
---

## What to build

The thing.
`;

const OTHER_TASK = `---
title: Other thing
slug: other-thing
---

Other.
`;

let root: string;
let arbiter: string;
let apply: string;
let agent: string;
let runnerTemp: string;
let baseSha: string;

function configure(repo: string): void {
	sh(repo, 'config', 'user.email', 't@t');
	sh(repo, 'config', 'user.name', 't');
	sh(repo, 'config', 'commit.gpgsign', 'false');
}

/**
 * A bare arbiter whose `main` holds the task, another item, a workflow, a note
 * and an ADR; an apply clone; and an agent clone on `work/task-add-thing`.
 */
function setup(opts: {untrusted?: boolean} = {}): void {
	arbiter = join(root, 'arbiter.git');
	sh(root, 'init', '-q', '--bare', '-b', 'main', arbiter);
	const seed = join(root, 'seed');
	sh(root, 'clone', '-q', arbiter, seed);
	configure(seed);
	sh(seed, 'checkout', '-qb', 'main');
	write(seed, 'README.md', 'readme\n');
	write(seed, 'src/index.ts', 'export {};\n');
	write(
		seed,
		'work/tasks/ready/add-thing.md',
		opts.untrusted ? UNTRUSTED_TASK : TASK,
	);
	write(seed, 'work/tasks/ready/other-thing.md', OTHER_TASK);
	write(seed, 'work/notes/observations/old-note.md', 'old\n');
	write(seed, '.github/workflows/ci.yml', 'on: push\n');
	write(seed, 'docs/adr/old.md', '# old\n');
	commitAll(seed, 'first');
	write(seed, 'src/second.ts', 'export {};\n');
	commitAll(seed, 'second');
	sh(seed, 'push', '-q', 'origin', 'main');
	baseSha = sh(seed, 'rev-parse', 'HEAD');

	apply = join(root, 'apply');
	sh(root, 'clone', '-q', arbiter, apply);
	agent = join(root, 'agent');
	sh(root, 'clone', '-q', arbiter, agent);
	configure(agent);
	sh(agent, 'checkout', '-qb', 'work/task-add-thing');
}

/** The done-move of the item's own task (its own transition). */
function doneMove(repo: string, body = TASK): void {
	mkdirSync(join(repo, 'work/tasks/done'), {recursive: true});
	sh(
		repo,
		'mv',
		'work/tasks/ready/add-thing.md',
		'work/tasks/done/add-thing.md',
	);
	write(repo, 'work/tasks/done/add-thing.md', body);
}

const INTEGRATE_RECORD = {
	schema: 1,
	item: 'task:add-thing',
	intent: {kind: 'integrate'},
	products: {prTitle: 'Add the thing', prBody: 'Adds it.'},
};

/**
 * Write the artifact directory by hand (as a hostile agent would): the record
 * as given and a bundle of `refs` (`<rev>` or `<rev> ^<base>` arguments).
 */
function writeArtifact(
	record: unknown = INTEGRATE_RECORD,
	bundleArgs: string[] | null = ['work/task-add-thing', `^${baseSha}`],
): string {
	const dir = join(runnerTemp, 'handoff');
	rmSync(dir, {recursive: true, force: true});
	mkdirSync(dir);
	writeFileSync(join(dir, HANDOFF_JSON), JSON.stringify(record));
	if (bundleArgs !== null) {
		sh(
			agent,
			'bundle',
			'create',
			'-q',
			join(dir, HANDOFF_BUNDLE),
			...bundleArgs,
		);
	}
	return dir;
}

function trust(overrides: Partial<ApplyTrust> = {}): ApplyTrust {
	return {
		item: 'task:add-thing',
		rung: 'build-task' as HandoffRung,
		baseSha,
		arbiter: 'origin',
		integrationMode: 'merge',
		...overrides,
	};
}

function refsSnapshot(repo: string): string {
	return sh(repo, 'for-each-ref', '--format=%(refname) %(objectname)');
}

function run(dir: string, t: ApplyTrust = trust()) {
	return validateApplyHandoff({dir, runnerTemp, repo: apply, trust: t});
}

/**
 * Assert a hostile handoff is rejected for `rule` (with `mentions` in the
 * reason), the arbiter's refs did not move, and the apply checkout received no
 * incoming ref (nothing was fetched into the repository under the dorfl name).
 */
function expectHostile(
	dir: string,
	rule: string,
	mentions: string[] = [],
	t: ApplyTrust = trust(),
): HandoffRejected {
	const before = refsSnapshot(arbiter);
	let caught: unknown;
	try {
		run(dir, t);
	} catch (e) {
		caught = e;
	}
	expect(caught, `expected a ${rule} rejection`).toBeInstanceOf(
		HandoffRejected,
	);
	const rejected = caught as HandoffRejected;
	expect(rejected.rule, rejected.message).toBe(rule);
	for (const m of mentions) expect(rejected.message).toContain(m);
	expect(refsSnapshot(arbiter)).toBe(before);
	expect(sh(apply, 'for-each-ref', '--format=%(refname)', 'refs/dorfl/')).toBe(
		'',
	);
	return rejected;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-apply-'));
	runnerTemp = join(root, 'runner-temp');
	mkdirSync(runnerTemp);
});
afterEach(() => {
	setHandoffByteLimitsForTest(undefined);
	rmSync(root, {recursive: true, force: true});
});

describe('an honest build handoff', () => {
	it('is accepted: the tip lands on the incoming ref, merge mode kept', () => {
		setup();
		write(agent, 'src/thing.ts', 'export const thing = 1;\n');
		commitAll(agent, 'add the thing');
		write(agent, 'work/notes/observations/new-note.md', 'seen\n');
		write(agent, 'docs/adr/new-decision.md', '# new\n');
		symlinkSync('../README.md', join(agent, 'docs/link-to-readme'));
		doneMove(agent);
		const tip = commitAll(agent, 'done');
		const before = refsSnapshot(arbiter);

		const out = run(writeArtifact());

		expect(out.mode).toBe('merge');
		expect(out.forcedPropose).toBe(false);
		expect(out.bundle?.tip).toBe(tip);
		expect(out.bundle?.newCommits).toHaveLength(2);
		expect(out.ledgerOutsideItem).toEqual([]);
		expect(out.ledgerReport).toBeUndefined();
		expect(sh(apply, 'rev-parse', INCOMING_TIP_REF)).toBe(tip);
		expect(refsSnapshot(arbiter)).toBe(before);
	});

	it('accepts a handoff without a bundle and checks no history', () => {
		setup();
		const out = run(
			writeArtifact(
				{
					schema: 1,
					item: 'task:add-thing',
					intent: {kind: 'needs-attention'},
					products: {reason: 'gate red'},
				},
				null,
			),
		);
		expect(out.bundle).toBeUndefined();
		expect(out.mode).toBe('merge');
	});
});

describe('hostile bundles are rejected before any write', () => {
	it('rejects a bundle that carries refs/heads/main', () => {
		setup();
		sh(agent, 'checkout', '-q', 'main');
		write(agent, 'src/evil.ts', 'evil\n');
		commitAll(agent, 'evil on main');
		expectHostile(
			writeArtifact(undefined, ['main', `^${baseSha}`]),
			'bundle-refs',
			['refs/heads/main', 'refs/heads/work/task-add-thing'],
		);
	});

	it("rejects a bundle that carries another item's branch", () => {
		setup();
		sh(agent, 'checkout', '-qb', 'work/task-other-thing');
		write(agent, 'src/other.ts', 'other\n');
		commitAll(agent, 'other');
		expectHostile(
			writeArtifact(undefined, ['work/task-other-thing', `^${baseSha}`]),
			'bundle-refs',
			['refs/heads/work/task-other-thing'],
		);
	});

	it('rejects a .github/ change', () => {
		setup();
		write(agent, '.github/workflows/ci.yml', 'on: push\n# changed\n');
		commitAll(agent, 'touch ci');
		const r = expectHostile(writeArtifact(), 'protected-path', [
			'.github/workflows/ci.yml',
			'locally',
		]);
		expect(r.message).toContain('build');
	});

	it('rejects a .github/ change added then reverted inside the range', () => {
		setup();
		write(agent, '.github/workflows/evil.yml', 'on: push\n');
		commitAll(agent, 'add evil');
		sh(agent, 'rm', '-q', '.github/workflows/evil.yml');
		commitAll(agent, 'remove evil');
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'work');
		// The final tree does not touch .github/, the history does.
		expect(sh(agent, 'diff', '--name-only', baseSha, 'HEAD')).toBe(
			'src/thing.ts',
		);
		expectHostile(writeArtifact(), 'protected-path', [
			'.github/workflows/evil.yml',
		]);
	});

	for (const path of [
		'CODEOWNERS',
		'docs/CODEOWNERS',
		'.github/CODEOWNERS',
		'dorfl.json',
		'.dorfl.json',
		'.lfsconfig',
		'.gitattributes',
		'src/.gitattributes',
		'.GitHub/workflows/x.yml',
	]) {
		it(`rejects a change to the protected path ${path}`, () => {
			setup();
			write(agent, path, '* merge=union\n');
			commitAll(agent, `touch ${path}`);
			expectHostile(writeArtifact(), 'protected-path', [path, 'locally']);
		});
	}

	it('rejects the deletion of a protected path', () => {
		setup();
		sh(agent, 'rm', '-q', '.github/workflows/ci.yml');
		commitAll(agent, 'drop ci');
		expectHostile(writeArtifact(), 'protected-path', [
			'.github/workflows/ci.yml',
		]);
	});

	it('rejects commits from an unrelated root', () => {
		setup();
		sh(agent, 'checkout', '-q', '--orphan', 'work/task-add-thing-2');
		sh(agent, 'rm', '-rqf', '.');
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'unrelated root');
		sh(agent, 'branch', '-qf', 'work/task-add-thing', 'HEAD');
		expectHostile(
			writeArtifact(undefined, ['work/task-add-thing']),
			'history',
			[baseSha],
		);
	});

	it('rejects commits based on an older main commit, not on baseSha', () => {
		setup();
		sh(agent, 'reset', '-q', '--hard', `${baseSha}~1`);
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'work on old base');
		expectHostile(
			writeArtifact(undefined, ['work/task-add-thing', `^${baseSha}~1`]),
			'history',
			[baseSha],
		);
	});

	it('rejects commits based on a commit that is not on main', () => {
		setup();
		write(agent, 'src/hidden.ts', 'hidden\n');
		const hidden = commitAll(agent, 'hidden base');
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'work');
		expectHostile(
			writeArtifact(undefined, ['work/task-add-thing', `^${hidden}`]),
			'history',
			[hidden],
		);
	});

	it('rejects a work branch that adds no commit', () => {
		setup();
		// The branch sits exactly on baseSha: `git bundle` refuses an empty
		// range, so the hostile bundle carries the whole history instead.
		expectHostile(
			writeArtifact(undefined, ['work/task-add-thing']),
			'history',
			['no new commit'],
		);
	});

	it('rejects a merge commit in the range', () => {
		setup();
		sh(agent, 'checkout', '-qb', 'side');
		write(agent, 'src/side.ts', 'side\n');
		commitAll(agent, 'side');
		sh(agent, 'checkout', '-q', 'work/task-add-thing');
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'work');
		sh(agent, 'merge', '-q', '--no-ff', '--no-edit', 'side');
		const r = expectHostile(writeArtifact(), 'merge-commit');
		expect(r.message).toContain(MERGE_COMMIT_REASON);
		expect(MERGE_COMMIT_REASON).toBe(
			'the work branch contains a merge commit; rebase it and requeue',
		);
	});

	it(`rejects over ${MAX_NEW_COMMITS} new commits`, () => {
		setup();
		expect(MAX_NEW_COMMITS).toBe(200);
		// fast-import keeps 201 commits cheap.
		let stream = '';
		for (let i = 1; i <= MAX_NEW_COMMITS + 1; i++) {
			stream +=
				`commit refs/heads/work/task-add-thing\n` +
				`committer t <t@t> ${1700000000 + i} +0000\n` +
				`data 2\nc\n` +
				(i === 1 ? `from ${baseSha}\n` : '') +
				'\n';
		}
		execFileSync('git', ['fast-import', '--quiet', '--force'], {
			cwd: agent,
			input: stream,
		});
		expectHostile(writeArtifact(), 'commit-count', [
			String(MAX_NEW_COMMITS + 1),
			String(MAX_NEW_COMMITS),
		]);
	});

	it('accepts exactly 200 new commits', () => {
		setup();
		let stream = '';
		for (let i = 1; i <= MAX_NEW_COMMITS; i++) {
			stream +=
				`commit refs/heads/work/task-add-thing\n` +
				`committer t <t@t> ${1700000000 + i} +0000\n` +
				`data 2\nc\n` +
				(i === 1 ? `from ${baseSha}\n` : '') +
				'\n';
		}
		execFileSync('git', ['fast-import', '--quiet', '--force'], {
			cwd: agent,
			input: stream,
		});
		expect(run(writeArtifact()).bundle?.newCommits).toHaveLength(200);
	});

	it('rejects handoff.json naming another item', () => {
		setup();
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'work');
		expectHostile(
			writeArtifact({...INTEGRATE_RECORD, item: 'task:other-thing'}),
			'item',
			['task:add-thing'],
		);
	});

	it('rejects a symlink escaping the repository', () => {
		setup();
		symlinkSync('../../etc/passwd', join(agent, 'src/passwd'));
		commitAll(agent, 'escape');
		expectHostile(writeArtifact(), 'symlink-target', ['src/passwd']);
	});

	it('rejects an absolute symlink', () => {
		setup();
		symlinkSync('/etc/passwd', join(agent, 'passwd'));
		commitAll(agent, 'escape');
		expectHostile(writeArtifact(), 'symlink-target', ['passwd']);
	});

	it('rejects a symlink that escapes only through another symlink', () => {
		setup();
		// Each link is inside the repository on its own; together `a` resolves
		// to `./..`, the parent of the repository.
		symlinkSync('.', join(agent, 'd'));
		symlinkSync('d/..', join(agent, 'a'));
		commitAll(agent, 'escape through a link');
		expectHostile(writeArtifact(), 'symlink-target', ['"a"']);
	});

	it('rejects a symlink into .git', () => {
		setup();
		symlinkSync('../.git/config', join(agent, 'src/config'));
		commitAll(agent, 'into .git');
		expectHostile(writeArtifact(), 'symlink-target', ['src/config']);
	});

	it('rejects a malformed object (the fetch runs with fsck)', () => {
		setup();
		const blob = sh(agent, 'hash-object', '-w', 'README.md');
		const entry = Buffer.concat([
			Buffer.from('100644 x\0'),
			Buffer.from(blob, 'hex'),
		]);
		// A tree with duplicate entries: fsck's duplicateEntries error.
		const tree = execFileSync(
			'git',
			['hash-object', '-t', 'tree', '-w', '--literally', '--stdin'],
			{cwd: agent, input: Buffer.concat([entry, entry])},
		)
			.toString()
			.trim();
		const commit = sh(agent, 'commit-tree', tree, '-p', baseSha, '-m', 'bad');
		sh(agent, 'update-ref', 'refs/heads/work/task-add-thing', commit);
		expectHostile(writeArtifact(), 'bundle-format', ['fsck']);
	});

	it('rejects a gitlink', () => {
		setup();
		sh(
			agent,
			'update-index',
			'--add',
			'--cacheinfo',
			`160000,${baseSha},vendor/sub`,
		);
		sh(agent, 'commit', '-qm', 'gitlink');
		expectHostile(writeArtifact(), 'gitlink', ['vendor/sub']);
	});

	it('rejects a work/ change to another item in merge mode', () => {
		setup();
		write(agent, 'work/tasks/ready/other-thing.md', OTHER_TASK + 'edited\n');
		doneMove(agent);
		commitAll(agent, 'edit another item');
		expectHostile(writeArtifact(), 'ledger', [
			'work/tasks/ready/other-thing.md',
		]);
	});

	for (const [label, rel] of [
		['a new file in a pool folder', 'work/tasks/ready/sneaky.md'],
		['a sidecar', 'work/questions/task-other-thing.md'],
		['an edit to an existing note', 'work/notes/observations/old-note.md'],
		['a protocol doc', 'work/protocol/WORK-CONTRACT.md'],
	] as const) {
		it(`rejects ${label} in merge mode`, () => {
			setup();
			write(agent, rel, 'hostile\n');
			commitAll(agent, label);
			expectHostile(writeArtifact(), 'ledger', [rel]);
		});
	}
});

describe('the work/ ledger rule in propose mode', () => {
	it('accepts the change and lists it in a PR-body section', () => {
		setup();
		write(agent, 'work/tasks/ready/other-thing.md', OTHER_TASK + 'edited\n');
		doneMove(agent);
		commitAll(agent, 'edit another item');
		const out = run(writeArtifact(), trust({integrationMode: 'propose'}));
		expect(out.mode).toBe('propose');
		expect(out.ledgerOutsideItem).toEqual(['work/tasks/ready/other-thing.md']);
		expect(out.ledgerReport).toBe(
			renderLedgerReportSection(['work/tasks/ready/other-thing.md']),
		);
		expect(out.ledgerReport).toContain('work/tasks/ready/other-thing.md');
		expect(out.ledgerReport).toMatch(/^### /);
		expect(sh(apply, 'rev-parse', INCOMING_TIP_REF)).toBe(
			sh(agent, 'rev-parse', 'HEAD'),
		);
	});

	it('renders hostile path names inertly and bounds the list', () => {
		const paths = Array.from({length: 120}, (_, i) => `work/x-${i}.md`);
		paths.unshift('work/evil\n```\n# injected.md');
		const section = renderLedgerReportSection(paths);
		expect(section).not.toContain('\n# injected');
		expect(section).toContain('injected.md');
		expect(section).toContain('more');
		expect(section.length).toBeLessThan(HANDOFF_LIMITS.commentChars);
	});
});

describe('the recomputed untrusted-origin policy', () => {
	it('forces propose from the task at baseSha even when the bundle strips the stamp', () => {
		setup({untrusted: true});
		write(agent, 'src/thing.ts', 'x\n');
		// The done-move rewrites the task WITHOUT `originTrust: untrusted`.
		doneMove(agent, TASK);
		commitAll(agent, 'done, stamp stripped');
		const out = run(writeArtifact());
		expect(out.mode).toBe('propose');
		expect(out.forcedPropose).toBe(true);
	});

	it('keeps merge for a trusted task', () => {
		setup();
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'work');
		expect(run(writeArtifact()).mode).toBe('merge');
	});

	it('an untrusted-origin build lists other-item ledger edits instead of rejecting', () => {
		setup({untrusted: true});
		write(agent, 'work/tasks/ready/other-thing.md', 'edited\n');
		commitAll(agent, 'edit another item');
		const out = run(writeArtifact());
		expect(out.mode).toBe('propose');
		expect(out.ledgerOutsideItem).toEqual(['work/tasks/ready/other-thing.md']);
	});

	it('never turns a trusted propose into merge', () => {
		setup();
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'work');
		expect(run(writeArtifact(), trust({integrationMode: 'propose'})).mode).toBe(
			'propose',
		);
	});
});

describe('size limits reject before anything is fetched into the repository', () => {
	function bigBlobBranch(): string {
		setup();
		// Incompressible, so the bundle is as big as the blob.
		write(agent, 'src/big.bin', randomBytes(3000).toString('base64'));
		commitAll(agent, 'big');
		return sh(agent, 'rev-parse', 'HEAD:src/big.bin');
	}

	function expectNotFetched(blob: string): void {
		expect(existsSync(join(apply, '.git'))).toBe(true);
		expect(() =>
			execFileSync('git', ['cat-file', '-e', blob], {
				cwd: apply,
				stdio: 'ignore',
			}),
		).toThrow();
	}

	it('the production limits are the spec values', () => {
		setHandoffByteLimitsForTest(undefined);
		expect(handoffByteLimits()).toEqual({
			artifactBytes: 200 * 1024 * 1024,
			bundleBytes: 100 * 1024 * 1024,
			blobBytes: 20 * 1024 * 1024,
			lfsBytes: 500 * 1024 * 1024,
			handoffJsonBytes: 2 * 1024 * 1024,
		});
	});

	it('rejects an artifact over the artifact limit', () => {
		const blob = bigBlobBranch();
		const dir = writeArtifact();
		setHandoffByteLimitsForTest({artifactBytes: 2000});
		expectHostile(dir, 'size', ['artifact']);
		expectNotFetched(blob);
	});

	it('rejects a bundle over the bundle limit', () => {
		const blob = bigBlobBranch();
		const dir = writeArtifact();
		setHandoffByteLimitsForTest({bundleBytes: 2000});
		expectHostile(dir, 'size', [HANDOFF_BUNDLE]);
		expectNotFetched(blob);
	});

	it('rejects a single blob over the blob limit', () => {
		const blob = bigBlobBranch();
		const dir = writeArtifact();
		setHandoffByteLimitsForTest({blobBytes: 3999});
		expectHostile(dir, 'size', ['src/big.bin']);
		expectNotFetched(blob);
	});
});

// ---------------------------------------------------------------------------
// Git LFS objects (task `ci-split-handoff-lfs-objects`, decision 6)
// ---------------------------------------------------------------------------

/** The canonical spec v1 pointer of `content`. */
function pointerOf(content: Buffer | string): string {
	const bytes = Buffer.from(content);
	const oid = createHash('sha256').update(bytes).digest('hex');
	return (
		'version https://git-lfs.github.com/spec/v1\n' +
		`oid sha256:${oid}\n` +
		`size ${bytes.length}\n`
	);
}

function oidOf(content: Buffer | string): string {
	return createHash('sha256').update(Buffer.from(content)).digest('hex');
}

/** Put `lfs/<oid>` with `bytes` into the artifact directory. */
function putLfsObject(dir: string, oid: string, bytes: Buffer | string): void {
	mkdirSync(join(dir, 'lfs'), {recursive: true});
	writeFileSync(join(dir, 'lfs', oid), bytes);
}

/** A hostile LFS case: rejected for `rule`, and nothing reached the apply LFS store. */
function expectLfsHostile(
	dir: string,
	rule: string,
	mentions: string[] = [],
): void {
	expectHostile(dir, rule, mentions);
	expect(existsSync(join(apply, '.git', 'lfs'))).toBe(false);
}

describe('LFS objects in the handoff', () => {
	const PAYLOAD = 'a large binary asset, stored in LFS\n'.repeat(40);

	it('accepts a pointer whose object is present, of the right size and hash', () => {
		setup();
		write(agent, 'assets/logo.bin', pointerOf(PAYLOAD));
		commitAll(agent, 'add an LFS asset');
		const dir = writeArtifact();
		putLfsObject(dir, oidOf(PAYLOAD), PAYLOAD);
		const out = run(dir);
		expect(out.lfsObjects.map((o) => o.oid)).toEqual([oidOf(PAYLOAD)]);
		expect(out.lfsObjects[0]!.size).toBe(Buffer.byteLength(PAYLOAD));
		// Validation writes nothing into the apply checkout's LFS store.
		expect(existsSync(join(apply, '.git', 'lfs'))).toBe(false);
	});

	it('accepts a bundle with no pointer and no lfs/ directory', () => {
		setup();
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'work');
		expect(run(writeArtifact()).lfsObjects).toEqual([]);
	});

	it('rejects a pointer with no object', () => {
		setup();
		write(agent, 'assets/logo.bin', pointerOf(PAYLOAD));
		commitAll(agent, 'add an LFS asset');
		expectLfsHostile(writeArtifact(), 'lfs-missing', [
			oidOf(PAYLOAD),
			'assets/logo.bin',
		]);
	});

	it('rejects a text file that parses as a pointer when its object is absent', () => {
		setup();
		// A legitimate test fixture that happens to be a pointer counts as one.
		write(agent, 'test/fixtures/pointer.txt', pointerOf('fixture'));
		commitAll(agent, 'add a fixture');
		expectLfsHostile(writeArtifact(), 'lfs-missing', [
			'test/fixtures/pointer.txt',
		]);
	});

	it('rejects an object whose hash does not match its pointer', () => {
		setup();
		write(agent, 'assets/logo.bin', pointerOf(PAYLOAD));
		commitAll(agent, 'add an LFS asset');
		const dir = writeArtifact();
		// Same size, other bytes.
		putLfsObject(dir, oidOf(PAYLOAD), PAYLOAD.replace('a large', 'A large'));
		expectLfsHostile(dir, 'lfs-mismatch', [oidOf(PAYLOAD), 'hash']);
	});

	it('rejects an object whose size does not match its pointer', () => {
		setup();
		write(agent, 'assets/logo.bin', pointerOf(PAYLOAD));
		commitAll(agent, 'add an LFS asset');
		const dir = writeArtifact();
		putLfsObject(dir, oidOf(PAYLOAD), PAYLOAD + 'more');
		expectLfsHostile(dir, 'lfs-mismatch', [oidOf(PAYLOAD), 'bytes']);
	});

	for (const [label, text] of [
		[
			'an extra key',
			pointerOf(PAYLOAD) + 'ext-0-foo sha256:' + 'a'.repeat(64) + '\n',
		],
		[
			'keys out of order',
			(() => {
				const [v, o, s] = pointerOf(PAYLOAD).split('\n');
				return `${v}\n${s}\n${o}\n`;
			})(),
		],
		[
			'a short oid',
			pointerOf(PAYLOAD).replace(/sha256:[0-9a-f]{4}/, 'sha256:'),
		],
		[
			'an upper-case oid',
			pointerOf(PAYLOAD).replace(
				/sha256:(.*)/,
				(_, h: string) => `sha256:${h.toUpperCase()}`,
			),
		],
		[
			'a size with a leading zero',
			pointerOf(PAYLOAD).replace('size ', 'size 0'),
		],
		['a missing final newline', pointerOf(PAYLOAD).slice(0, -1)],
		['CRLF line ends', pointerOf(PAYLOAD).replace(/\n/g, '\r\n')],
		[
			'the legacy hawser version',
			pointerOf(PAYLOAD).replace(
				'https://git-lfs.github.com/spec/v1',
				'https://hawser.github.com/spec/v1',
			),
		],
	] as const) {
		it(`rejects a malformed pointer (${label})`, () => {
			setup();
			write(agent, 'assets/logo.bin', text);
			commitAll(agent, 'add a malformed pointer');
			const dir = writeArtifact();
			putLfsObject(dir, oidOf(PAYLOAD), PAYLOAD);
			expectLfsHostile(dir, 'lfs-pointer', ['assets/logo.bin']);
		});
	}

	it('rejects an unreferenced extra object', () => {
		setup();
		write(agent, 'assets/logo.bin', pointerOf(PAYLOAD));
		commitAll(agent, 'add an LFS asset');
		const dir = writeArtifact();
		putLfsObject(dir, oidOf(PAYLOAD), PAYLOAD);
		putLfsObject(dir, oidOf('quota filler'), 'quota filler');
		expectLfsHostile(dir, 'lfs-extra', [oidOf('quota filler')]);
	});

	it('rejects an extra object next to a bundle that carries no pointer', () => {
		setup();
		write(agent, 'src/thing.ts', 'x\n');
		commitAll(agent, 'work');
		const dir = writeArtifact();
		putLfsObject(dir, oidOf('quota filler'), 'quota filler');
		expectLfsHostile(dir, 'lfs-extra', [oidOf('quota filler')]);
	});

	it('rejects an object over the LFS size limit', () => {
		setup();
		write(agent, 'assets/logo.bin', pointerOf(PAYLOAD));
		commitAll(agent, 'add an LFS asset');
		const dir = writeArtifact();
		putLfsObject(dir, oidOf(PAYLOAD), PAYLOAD);
		setHandoffByteLimitsForTest({lfsBytes: Buffer.byteLength(PAYLOAD) - 1});
		expectLfsHostile(dir, 'size', ['LFS']);
	});

	it('rejects a pointer whose size is over the LFS size limit, before looking for its object', () => {
		setup();
		const huge =
			'version https://git-lfs.github.com/spec/v1\n' +
			`oid sha256:${'e'.repeat(64)}\n` +
			`size ${handoffByteLimits().lfsBytes + 1}\n`;
		write(agent, 'assets/huge.bin', huge);
		commitAll(agent, 'add a huge pointer');
		expectLfsHostile(writeArtifact(), 'size', ['assets/huge.bin']);
	});

	it('rejects a .lfsconfig change even with its objects present (protected path)', () => {
		setup();
		write(agent, '.lfsconfig', '[lfs]\n\turl = https://evil.example/lfs\n');
		write(agent, 'assets/logo.bin', pointerOf(PAYLOAD));
		commitAll(agent, 'redirect the LFS endpoint');
		const dir = writeArtifact();
		putLfsObject(dir, oidOf(PAYLOAD), PAYLOAD);
		expectLfsHostile(dir, 'protected-path', ['.lfsconfig', 'locally']);
	});

	it('scans pointers added in an earlier commit and changed later', () => {
		setup();
		write(agent, 'assets/logo.bin', pointerOf('first version'));
		commitAll(agent, 'first');
		write(agent, 'assets/logo.bin', pointerOf(PAYLOAD));
		commitAll(agent, 'second');
		const dir = writeArtifact();
		putLfsObject(dir, oidOf(PAYLOAD), PAYLOAD);
		// The first version's object is referenced by a new commit too.
		expectLfsHostile(dir, 'lfs-missing', [oidOf('first version')]);
	});
});

describe('protectedPathOf', () => {
	it('matches the fixed list and nothing else', () => {
		for (const p of [
			'.github',
			'.github/workflows/ci.yml',
			'CODEOWNERS',
			'docs/CODEOWNERS',
			'dorfl.json',
			'.dorfl.json',
			'.lfsconfig',
			'.gitattributes',
			'a/b/.gitattributes',
		]) {
			expect(protectedPathOf(p), p).toBeDefined();
		}
		for (const p of [
			'src/CODEOWNERS',
			'src/dorfl.json',
			'src/.lfsconfig',
			'docs/github/x',
			'.githubx/y',
			'README.md',
		]) {
			expect(protectedPathOf(p), p).toBeUndefined();
		}
	});
});
