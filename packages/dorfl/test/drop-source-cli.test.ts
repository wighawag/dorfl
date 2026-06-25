import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import type {Command} from 'commander';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {buildProgram} from '../src/cli.js';
import {dropSource} from '../src/drop-source.js';
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	gitEnv,
	gitIn,
	fixtureFolderRel,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `direct-delete-question-cli-helper` task (prd
 * `agentic-question-resolution-retire-disposition-vocabulary`, US #5/#11) — the
 * DIRECT-delete verb `dorfl drop <slug>` + its `dropSource` logic, proven over a
 * THROWAWAY git repo (the house pattern). The acceptance criteria pinned here:
 *
 *   - a verb deletes a named source + its sidecar (when present) in ONE commit,
 *     with the reason in the commit MESSAGE;
 *   - the source is resolved by its NAMESPACED IDENTITY (task / prd / observation
 *     / bare slug);
 *   - the deletion is a SINGLE revertible commit (a wrong delete is git-recoverable);
 *   - the verb does NOT round-trip through the decision engine (no agent, no
 *     verdict) — it is the direct human/skill/CLI path;
 *   - the work is ISOLATED in a throwaway repo (no shared/global location written).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-drop-source-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Files touched by the HEAD commit (relative paths). */
function filesInHeadCommit(repo: string): string[] {
	return gitIn(['show', '--name-only', '--format=', 'HEAD'], repo)
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l !== '');
}

/** The full HEAD commit message (subject + body). */
function headCommitMessage(repo: string): string {
	return gitIn(['log', '-1', '--format=%B', 'HEAD'], repo);
}

/** How many commits are on `main`. */
function commitCount(repo: string): number {
	return Number.parseInt(
		gitIn(['rev-list', '--count', 'HEAD'], repo).trim(),
		10,
	);
}

/**
 * Seed a throwaway repo with one item (in its lifecycle folder) and, optionally,
 * its question sidecar. Returns the repo path + the two repo-relative paths.
 */
function seed(opts: {
	slug?: string;
	folder?: string;
	type?: string;
	identity?: string;
	withSidecar?: boolean;
}): {repo: string; itemPath: string; sidecarPath: string} {
	const slug = opts.slug ?? 'foo';
	const folder = opts.folder ?? 'backlog';
	const type = opts.type ?? 'task';
	const identity = opts.identity ?? `${type}:${slug}`;
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	// Stamp a LOCAL identity so the CLI end-to-end path (which threads the ambient
	// `process.env`, not the test's gitEnv) can still commit without depending on
	// the developer's / CI's global git config.
	gitIn(['config', 'user.name', 'Test Runner'], repo);
	gitIn(['config', 'user.email', 'test@example.com'], repo);

	const itemPath = `work/${fixtureFolderRel(folder)}/${slug}.md`;
	mkdirSync(join(repo, 'work', fixtureFolderRel(folder)), {recursive: true});
	writeFileSync(
		join(repo, itemPath),
		[
			'---',
			`title: ${slug}`,
			`slug: ${slug}`,
			'blockedBy: []',
			'---',
			'',
			'## What to build',
			'',
			'a thing',
			'',
		].join('\n'),
	);

	const sidecarPath = sidecarPathFor(identity);
	if (opts.withSidecar !== false) {
		const model = newSidecar(identity, [{question: 'still want this?'}]);
		const answered = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'no, bin it'})),
		};
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPath), serialiseSidecar(answered));
	}

	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed item (+ sidecar)'], repo);
	return {repo, itemPath, sidecarPath};
}

describe('dropSource — direct delete of a source + its sidecar (logic)', () => {
	it('git rm-s the source AND its sidecar in ONE commit, the reason in the message', () => {
		const {repo, itemPath, sidecarPath} = seed({});
		const before = commitCount(repo);

		const result = dropSource({
			cwd: repo,
			item: 'task:foo',
			reason: 'duplicate of bar; throwing it away',
			env: gitEnv(),
		});

		expect(result.outcome).toBe('deleted');
		expect(result.item).toBe('task:foo');
		expect(result.itemPath).toBe(itemPath);
		expect(result.sidecarPath).toBe(sidecarPath);

		// Both files are GONE from the working tree...
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);

		// ...removed in exactly ONE new commit that touched BOTH.
		expect(commitCount(repo)).toBe(before + 1);
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).toContain(sidecarPath);

		// The reason is recorded in the commit MESSAGE (git history is the archive).
		const msg = headCommitMessage(repo);
		expect(msg).toContain('duplicate of bar; throwing it away');
		expect(msg).toMatch(/task:foo/);
	});

	it('the deletion is a SINGLE revertible commit (git revert restores both files)', () => {
		const {repo, itemPath, sidecarPath} = seed({});

		dropSource({cwd: repo, item: 'task:foo', reason: 'oops', env: gitEnv()});
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);

		// One revert of the single delete commit brings BOTH files back.
		gitIn(['revert', '--no-edit', 'HEAD'], repo);
		expect(existsSync(join(repo, itemPath))).toBe(true);
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
	});

	it('deletes the source EVEN WHEN no sidecar is present (no open-question conversation)', () => {
		const {repo, itemPath, sidecarPath} = seed({withSidecar: false});
		expect(existsSync(join(repo, sidecarPath))).toBe(false);

		const result = dropSource({cwd: repo, item: 'task:foo', env: gitEnv()});

		expect(result.outcome).toBe('deleted');
		expect(result.sidecarPath).toBeUndefined();
		expect(existsSync(join(repo, itemPath))).toBe(false);
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).not.toContain(sidecarPath);
		// An omitted reason is recorded honestly, not refused.
		expect(headCommitMessage(repo)).toContain('(no reason given)');
	});

	it('resolves the source by IDENTITY across namespaces (prd / observation / bare)', () => {
		// A PRD source in its pool folder, found by the `prd:` identity.
		const prd = seed({
			slug: 'plan',
			type: 'prd',
			folder: 'prd',
			identity: 'prd:plan',
		});
		const prdResult = dropSource({
			cwd: prd.repo,
			item: 'prd:plan',
			env: gitEnv(),
		});
		expect(prdResult.outcome).toBe('deleted');
		expect(prdResult.itemPath).toBe(prd.itemPath);
		expect(existsSync(join(prd.repo, prd.itemPath))).toBe(false);

		scratch.cleanup();
		scratch = makeScratch('dorfl-drop-source-');

		// An OBSERVATION source, named via the `obs:` alias (canonicalised to
		// `observation:`).
		const obs = seed({
			slug: 'noise',
			type: 'observation',
			folder: 'observations',
			identity: 'observation:noise',
		});
		const obsResult = dropSource({
			cwd: obs.repo,
			item: 'obs:noise',
			env: gitEnv(),
		});
		expect(obsResult.outcome).toBe('deleted');
		expect(obsResult.item).toBe('observation:noise');
		expect(existsSync(join(obs.repo, obs.itemPath))).toBe(false);

		scratch.cleanup();
		scratch = makeScratch('dorfl-drop-source-');

		// A BARE slug resolves to the TASK namespace.
		const bare = seed({slug: 'loose', type: 'task', folder: 'backlog'});
		const bareResult = dropSource({
			cwd: bare.repo,
			item: 'loose',
			env: gitEnv(),
		});
		expect(bareResult.outcome).toBe('deleted');
		expect(bareResult.item).toBe('task:loose');
		expect(existsSync(join(bare.repo, bare.itemPath))).toBe(false);
	});

	it('is a clean no-op (no commit) when the named source is already gone', () => {
		const {repo} = seed({withSidecar: false});
		const before = commitCount(repo);

		const result = dropSource({
			cwd: repo,
			item: 'task:does-not-exist',
			env: gitEnv(),
		});

		expect(result.outcome).toBe('not-found');
		expect(result.commit).toBeUndefined();
		expect(commitCount(repo)).toBe(before); // NO new commit.
	});
});

describe('dropSource — does NOT round-trip through the decision engine', () => {
	it('deletes a source that has NEVER been through a sidecar/answer flow', () => {
		// No sidecar, no answered questions, no engine state — a raw, direct delete.
		const {repo, itemPath} = seed({withSidecar: false});
		const result = dropSource({cwd: repo, item: 'task:foo', env: gitEnv()});
		expect(result.outcome).toBe('deleted');
		expect(existsSync(join(repo, itemPath))).toBe(false);
		// The commit subject is the DIRECT-drop subject, NOT the agentic
		// `advance: … → deleted` discharge subject (no engine path).
		const subject = gitIn(['log', '-1', '--format=%s', 'HEAD'], repo).trim();
		expect(subject).toMatch(/^drop:/);
		expect(subject).not.toMatch(/^advance:/);
	});
});

/** Find a subcommand by name on a freshly-built program. */
function command(name: string): Command {
	const program = buildProgram();
	const cmd = program.commands.find((c) => c.name() === name);
	if (!cmd) {
		throw new Error(`no '${name}' command registered`);
	}
	return cmd;
}

describe('drop — the CLI verb is wired (grammar)', () => {
	it('registers a top-level `drop <slug>` command', () => {
		expect(command('drop').name()).toBe('drop');
		expect(command('drop').usage()).toMatch(/<slug>/);
	});

	it('carries the --reason, --cwd companions', () => {
		const flags = command('drop').options.map((o) => o.flags);
		expect(flags.some((f) => f.startsWith('--reason'))).toBe(true);
		expect(flags.some((f) => f.startsWith('--cwd'))).toBe(true);
	});

	it('its description names it the direct-delete path that does NOT use the engine', () => {
		const desc = command('drop').description();
		expect(desc).toMatch(/does NOT round-trip through the decision engine/i);
		expect(desc).toMatch(/revertible/i);
	});

	it('is DISTINCT from the hub-mirror `remote rm` deleter (no name collision)', () => {
		// `drop` is a top-level verb; the mirror deleter is `remote rm` (a
		// subcommand of `remote`). They never collide.
		expect(command('drop').name()).toBe('drop');
		const remote = command('remote');
		const sub = remote.commands.map((c) => c.name());
		expect(sub).toContain('rm');
		expect(sub).not.toContain('drop');
	});
});

describe('drop — the CLI verb end-to-end over a throwaway repo', () => {
	it('`dorfl drop <slug> --reason ...` removes source + sidecar in one revertible commit', async () => {
		const {repo, itemPath, sidecarPath} = seed({});
		const before = commitCount(repo);

		const program = buildProgram();
		await program.parseAsync(
			[
				'node',
				'dorfl',
				'drop',
				'task:foo',
				'--cwd',
				repo,
				'--reason',
				'binning this via the CLI',
			],
			{from: 'node'},
		);

		// Source + sidecar gone, in exactly ONE new commit, reason in the message.
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(commitCount(repo)).toBe(before + 1);
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).toContain(sidecarPath);
		expect(headCommitMessage(repo)).toContain('binning this via the CLI');

		// Recoverable: one revert restores both.
		gitIn(['revert', '--no-edit', 'HEAD'], repo);
		expect(existsSync(join(repo, itemPath))).toBe(true);
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
	});

	it('writes ONLY in the throwaway repo (no shared/global location)', () => {
		// The seed + the drop both confine writes to `scratch.root`; assert the
		// repo lives under it and nothing escapes (the env isolates git config too).
		const {repo} = seed({});
		expect(repo.startsWith(scratch.root)).toBe(true);
		dropSource({cwd: repo, item: 'task:foo', env: gitEnv()});
		// HEAD is a local commit in the throwaway repo — no remote/global push.
		const remotes = run('git', ['remote'], repo, {env: gitEnv()}).stdout.trim();
		expect(remotes).toBe(''); // never configured a remote; nothing pushed anywhere.
	});
});
