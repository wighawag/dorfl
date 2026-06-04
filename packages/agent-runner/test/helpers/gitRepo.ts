import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run, git} from '../../src/git.js';

/** Deterministic git identity + non-interactive env for throwaway test repos. */
export function gitEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		GIT_AUTHOR_NAME: 'Test Runner',
		GIT_AUTHOR_EMAIL: 'test@example.com',
		GIT_COMMITTER_NAME: 'Test Runner',
		GIT_COMMITTER_EMAIL: 'test@example.com',
		GIT_TERMINAL_PROMPT: '0',
	};
}

/** A scratch workspace that cleans itself up. */
export interface Scratch {
	root: string;
	cleanup(): void;
}

export function makeScratch(prefix = 'agent-runner-git-'): Scratch {
	const root = mkdtempSync(join(tmpdir(), prefix));
	return {
		root,
		cleanup() {
			rmSync(root, {recursive: true, force: true});
		},
	};
}

function gx(args: string[], cwd: string): string {
	return git(args, cwd, {env: gitEnv()});
}

/**
 * Build a throwaway project repo with a `work/backlog/<slug>.md` for each given
 * slug, plus a sibling local `--bare` arbiter the project pushes its `main` to.
 * Returns the working-clone path, the arbiter path, and a `clone()` that makes
 * an additional independent clone of the arbiter (for parallel isolation tests).
 */
export interface SeededRepo {
	repo: string;
	arbiter: string;
	clone(label: string): string;
}

export function seedRepoWithArbiter(
	root: string,
	slugs: string[],
	opts: {
		humanOnly?: boolean;
		needsAnswers?: boolean;
		blockedBy?: string[];
		promptBody?: string;
	} = {},
): SeededRepo {
	const repo = join(root, 'project');
	mkdirSync(repo, {recursive: true});
	gx(['init', '-q', '-b', 'main'], repo);

	const backlog = join(repo, 'work', 'backlog');
	mkdirSync(backlog, {recursive: true});
	for (const slug of slugs) {
		writeFileSync(join(backlog, `${slug}.md`), sliceFile(slug, opts));
	}
	writeFileSync(join(repo, 'README.md'), '# project\n');
	gx(['add', '-A'], repo);
	gx(['commit', '-q', '-m', 'seed'], repo);

	// Bare arbiter next to (not inside) the working clone.
	const arbiter = join(root, 'project-work.git');
	gx(['clone', '-q', '--bare', repo, arbiter], root);
	gx(['remote', 'add', 'arbiter', `file://${arbiter}`], repo);
	gx(['fetch', '-q', 'arbiter'], repo);

	let n = 0;
	return {
		repo,
		arbiter,
		clone(label: string): string {
			const dest = join(root, `clone-${label}-${n++}`);
			gx(['clone', '-q', `file://${arbiter}`, dest], root);
			gx(['remote', 'add', 'arbiter', `file://${arbiter}`], dest);
			gx(['fetch', '-q', 'arbiter'], dest);
			return dest;
		},
	};
}

function sliceFile(
	slug: string,
	opts: {
		humanOnly?: boolean;
		needsAnswers?: boolean;
		blockedBy?: string[];
		promptBody?: string;
	},
): string {
	const body = opts.promptBody ?? `> Implement ${slug}.`;
	const gateLines = [
		...(opts.humanOnly === true ? ['humanOnly: true'] : []),
		...(opts.needsAnswers === true ? ['needsAnswers: true'] : []),
	];
	const blockedBy =
		opts.blockedBy && opts.blockedBy.length > 0
			? `blockedBy: [${opts.blockedBy.join(', ')}]`
			: 'blockedBy: []';
	return [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		...gateLines,
		blockedBy,
		'---',
		'',
		'## What to build',
		'',
		'thing',
		'',
		'## Acceptance criteria',
		'',
		'- [ ] works',
		'',
		'## Prompt',
		'',
		body,
		'',
	].join('\n');
}

/**
 * Seed a `work/done/<slug>.md` directly onto `<arbiter>/main` (simulating a
 * completed dependency), via a throwaway clone so the checkout under test is
 * left untouched. Used to satisfy a slice's `blockedBy` for readiness tests.
 */
export function seedDoneOnArbiter(seeded: SeededRepo, slug: string): void {
	const dest = join(seeded.repo, '..', `seed-done-${slug}`);
	gx(['clone', '-q', `file://${seeded.arbiter}`, dest], seeded.repo);
	gx(['remote', 'add', 'arbiter', `file://${seeded.arbiter}`], dest);
	gx(['fetch', '-q', 'arbiter'], dest);
	gx(['checkout', '-q', '-B', `seed-done/${slug}`, 'arbiter/main'], dest);
	const doneDir = join(dest, 'work', 'done');
	mkdirSync(doneDir, {recursive: true});
	writeFileSync(join(doneDir, `${slug}.md`), sliceFile(slug, {}));
	gx(['add', '-A'], dest);
	gx(['commit', '-q', '-m', `done: ${slug}`], dest);
	gx(['push', '-q', 'arbiter', `seed-done/${slug}:main`], dest);
	rmSync(dest, {recursive: true, force: true});
}

/** Does `<arbiter>/main` currently track `work/<status>/<slug>.md`? */
export function existsOnArbiterMain(
	cwd: string,
	status: 'backlog' | 'in-progress' | 'done',
	slug: string,
): boolean {
	run('git', ['fetch', '-q', 'arbiter'], cwd, {env: gitEnv()});
	const res = run(
		'git',
		['cat-file', '-e', `arbiter/main:work/${status}/${slug}.md`],
		cwd,
		{env: gitEnv()},
	);
	return res.status === 0;
}

export {gx as gitIn};
