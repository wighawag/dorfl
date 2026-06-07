import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {run, git} from '../../src/git.js';
import {mirrorPath} from '../../src/repo-mirror.js';

/**
 * Deterministic git identity + non-interactive env for throwaway test repos.
 *
 * Crucially, it ISOLATES git from the developer's / CI's real global + system
 * config: `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null` and
 * `GIT_CONFIG_NOSYSTEM=1` mean every test git invocation sees ONLY the repo-local
 * config it sets up. Without this, all tests share the real `~/.gitconfig`
 * (identity, `includeIf`, hooks, `core.*`), which both pollutes results and is a
 * contention/interference point when many test files run git concurrently.
 */
export function gitEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		GIT_AUTHOR_NAME: 'Test Runner',
		GIT_AUTHOR_EMAIL: 'test@example.com',
		GIT_COMMITTER_NAME: 'Test Runner',
		GIT_COMMITTER_EMAIL: 'test@example.com',
		GIT_TERMINAL_PROMPT: '0',
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_SYSTEM: '/dev/null',
		GIT_CONFIG_NOSYSTEM: '1',
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

/**
 * Isolate pi's session storage for a test that exercises the DEFAULT session path
 * (`generateSessionPath`/`piDefaultSessionDir`, which resolve to
 * `~/.pi/agent/sessions/` unless `PI_CODING_AGENT_DIR` is set). Without this, a
 * test that launches the (stubbed) pi adapter writes its session `.jsonl` into the
 * developer's REAL `~/.pi/agent/sessions/`, leaking dirs there and (with a
 * malformed fixture header) crashing any tool that lists sessions (e.g. the
 * pi-remote dashboard). Points `PI_CODING_AGENT_DIR` at a scratch dir for the
 * duration; call the returned fn in `afterEach` to restore. (`generateSessionPath`
 * runs IN-PROCESS, so we must set the test process's own `process.env`, not just an
 * env passed to a child.)
 */
export function isolatePiAgentDir(scratchRoot: string): () => void {
	const KEY = 'PI_CODING_AGENT_DIR';
	const prev = process.env[KEY];
	process.env[KEY] = join(scratchRoot, '.pi-agent');
	return () => {
		if (prev === undefined) {
			delete process.env[KEY];
		} else {
			process.env[KEY] = prev;
		}
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
		/** PRD slugs to seed under `work/prd/<slug>.md` (for the slicing lock). */
		prds?: string[];
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
	if (opts.prds && opts.prds.length > 0) {
		const prdDir = join(repo, 'work', 'prd');
		mkdirSync(prdDir, {recursive: true});
		for (const slug of opts.prds) {
			writeFileSync(join(prdDir, `${slug}.md`), prdFile(slug));
		}
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

/** A minimal PRD file body for `work/prd/<slug>.md` (slicing-lock fixtures). */
export function prdFile(slug: string, marker = 'ORIGINAL'): string {
	return [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		'---',
		'',
		'## Problem Statement',
		'',
		`PRD body for ${slug} (${marker}).`,
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
	status: 'backlog' | 'in-progress' | 'needs-attention' | 'done',
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

/**
 * Register a BARE hub mirror under `<workspacesDir>/repos/<key>.git` whose
 * `main` ref carries the given `work/` content — the registry-model fixture for
 * `scan`/`status` (which read each mirror's bare `main` ref, NOT a working tree).
 *
 * It builds a throwaway WORKING repo with the `work/` files committed on `main`,
 * then `git clone --bare`s it into the mirror location (so `origin` points at
 * the source repo — a `file://` URL, transport `local-bare`). The mirror is keyed
 * off that origin URL via `mirrorPath`, exactly as `remote add`/`ensureMirror`
 * key it. Returns the mirror path + its origin URL.
 */
export interface RegisteredMirrorFixture {
	mirrorPath: string;
	originUrl: string;
}

export function registerMirrorWithWork(
	workspacesDir: string,
	name: string,
	work: {
		backlog?: Record<string, string>;
		done?: Record<string, string>;
		needsAttention?: Record<string, string>;
	},
): RegisteredMirrorFixture {
	// 1. A throwaway working repo (the would-be arbiter source) with the work/ tree.
	const src = join(workspacesDir, '..', `mirror-src-${name}`);
	mkdirSync(src, {recursive: true});
	gx(['init', '-q', '-b', 'main'], src);
	const writeAll = (
		folder: string,
		files: Record<string, string> | undefined,
	) => {
		if (!files) {
			return;
		}
		const dir = join(src, 'work', folder);
		mkdirSync(dir, {recursive: true});
		for (const [file, content] of Object.entries(files)) {
			writeFileSync(join(dir, file), content);
		}
	};
	writeAll('backlog', work.backlog);
	writeAll('done', work.done);
	writeAll('needs-attention', work.needsAttention);
	writeFileSync(join(src, 'README.md'), `# ${name}\n`);
	gx(['add', '-A'], src);
	gx(['commit', '-q', '-m', 'seed work tree'], src);

	// 2. The bare hub mirror, keyed off the source's file:// URL (as ensureMirror).
	const originUrl = `file://${src}`;
	const dest = mirrorPath(workspacesDir, originUrl);
	mkdirSync(dirname(dest), {recursive: true});
	gx(['clone', '--quiet', '--bare', originUrl, dest], dirname(dest));
	return {mirrorPath: dest, originUrl};
}

export {gx as gitIn};
