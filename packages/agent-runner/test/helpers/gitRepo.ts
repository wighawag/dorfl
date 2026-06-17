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

/**
 * A DISTINCT-committer git env for ONE racer in a two-racer CAS test, modelling
 * two DISTINCT PRINCIPALS contending for the same ledger ref.
 *
 * IMPORTANT — this is a CONVENIENCE, not the thing that makes the CAS correct.
 * The CAS is authoritative ON ITS OWN, even when two racers share ONE identity
 * and build a BYTE-IDENTICAL tree + message off the SAME base within git's
 * 1-second timestamp resolution: `applyTransition` (`src/ledger-write.ts`) stamps
 * EACH attempt's transition commit with a fresh per-attempt `CAS-Nonce` trailer,
 * so the two racers' commits ALWAYS get DISTINCT shas. The loser's
 * `--force-with-lease=main:<base>` push then finds `main` advanced past `<base>`
 * and is GENUINELY rejected (not an "Everything up-to-date" no-op), and the
 * post-push verify (`<arbiter>/main === <our nonce'd sha>`) correctly fails for
 * it. So exactly-one-winner holds with NO identity distinctness — see the
 * identical-identity regression tests in `advance-triage.test.ts` /
 * `triage-persist.test.ts`.
 *
 * HISTORY: an earlier flake ("2 winners" under full-suite parallel load) was once
 * pinned on a TEST-FIXTURE coincidence — both racers using the SAME {@link
 * gitEnv} identity + SAME tree + SAME message + SAME base produced BYTE-IDENTICAL
 * shas, and the pre-nonce verify (`<arbiter>/main === head`) passed for BOTH.
 * `racerEnv` was added to give racers distinct shas. But that only HID the
 * product defect (it removed the fixture's sha-collision, not the product's
 * exposure to one): the same collision is reachable in PRODUCTION whenever one
 * bot identity advances two same-slug items. The nonce fixes the PRODUCT, so
 * `racerEnv`/{@link raceClone} are now purely for tests that WANT to model
 * distinct principals — NOT a precondition for CAS correctness. It does NOT weaken
 * the one-winner invariant.
 */
export function racerEnv(who: string): NodeJS.ProcessEnv {
	return {
		...gitEnv(),
		GIT_AUTHOR_NAME: `Racer ${who}`,
		GIT_AUTHOR_EMAIL: `racer-${who}@example.com`,
		GIT_COMMITTER_NAME: `Racer ${who}`,
		GIT_COMMITTER_EMAIL: `racer-${who}@example.com`,
	};
}

/**
 * Clone the arbiter into a racer working clone AND stamp it with a DISTINCT local
 * committer identity (`user.name`/`user.email`) — the companion of {@link racerEnv}
 * for two-racer CAS tests whose racer calls pass NO explicit `env` (so git reads
 * identity from the clone's LOCAL config, e.g. the `performAdvance`/engine path
 * which threads no env).
 *
 * Like {@link racerEnv} this models two DISTINCT PRINCIPALS; it is NOT what makes
 * the CAS correct. The CAS is authoritative even under IDENTICAL identity via the
 * per-attempt `CAS-Nonce` the write seam stamps (see {@link racerEnv}); use this
 * only when a test WANTS distinct principals. For racer calls that DO pass an
 * explicit `env`, pass {@link racerEnv}(who) instead (env-vars override local
 * config), and use the SAME distinct `who` for any `by` argument.
 */
export function raceClone(seeded: SeededRepo, who: string): string {
	const dir = seeded.clone(who);
	gx(['config', 'user.name', `Racer ${who}`], dir);
	gx(['config', 'user.email', `racer-${who}@example.com`], dir);
	return dir;
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
		/**
		 * Commit a `.agent-runner.json` at the repo root (so it travels onto
		 * `<arbiter>/main`) — the per-repo config the no-checkout `do --remote` reads
		 * from the arbiter. The object is JSON-stringified verbatim, so a test can
		 * seed BOTH allowed keys (`harness`/`verify`/…) and rejected host-only keys
		 * (`agentCmd`/`piBin`/…) to exercise the allow/reject split.
		 */
		repoConfig?: Record<string, unknown>;
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
	if (opts.repoConfig) {
		writeFileSync(
			join(repo, '.agent-runner.json'),
			JSON.stringify(opts.repoConfig, null, 2) + '\n',
		);
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
 * Does `<arbiter>/main` currently track an ARBITRARY repo-relative `path` (e.g. a
 * sidecar `work/questions/slice-<slug>.md`)? The path-keyed sibling of
 * {@link existsOnArbiterMain} for the tree-less rungs' results, which live outside
 * the `work/<status>/<slug>.md` shape.
 */
export function pathOnArbiterMain(cwd: string, path: string): boolean {
	run('git', ['fetch', '-q', 'arbiter'], cwd, {env: gitEnv()});
	const res = run('git', ['cat-file', '-e', `arbiter/main:${path}`], cwd, {
		env: gitEnv(),
	});
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

/** The throwaway source repo (the mirror's origin) for `name`. */
export function mirrorSrc(workspacesDir: string, name: string): string {
	return join(workspacesDir, '..', `mirror-src-${name}`);
}

export function registerMirrorWithWork(
	workspacesDir: string,
	name: string,
	work: {
		backlog?: Record<string, string>;
		inProgress?: Record<string, string>;
		done?: Record<string, string>;
		needsAttention?: Record<string, string>;
		/**
		 * Files committed under `work/dropped/` (the generic terminal "won't-proceed"
		 * folder — slice
		 * `generic-terminal-dropped-folder-generalising-out-of-scope`). Generalises
		 * the previous `outOfScope` key.
		 */
		dropped?: Record<string, string>;
		/** PRDs to slice, committed under `work/prd/` on the mirror's `main`. */
		prd?: Record<string, string>;
		/** Already-SLICED PRDs, committed under `work/prd-sliced/` (sliced-ness residence). */
		prdSliced?: Record<string, string>;
		/** Observations committed under `work/observations/` (the triage candidate pool). */
		observations?: Record<string, string>;
		/** Sidecars committed under `work/questions/` (`<type>-<slug>.md`). */
		questions?: Record<string, string>;
		/** A `.agent-runner.json` committed at the repo root (travels onto the mirror's `main`). */
		repoConfig?: Record<string, unknown>;
	},
): RegisteredMirrorFixture {
	// 1. A throwaway working repo (the would-be arbiter source) with the work/ tree.
	const src = mirrorSrc(workspacesDir, name);
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
	writeAll('in-progress', work.inProgress);
	writeAll('done', work.done);
	writeAll('needs-attention', work.needsAttention);
	writeAll('dropped', work.dropped);
	writeAll('prd', work.prd);
	writeAll('prd-sliced', work.prdSliced);
	writeAll('observations', work.observations);
	writeAll('questions', work.questions);
	if (work.repoConfig) {
		writeFileSync(
			join(src, '.agent-runner.json'),
			JSON.stringify(work.repoConfig, null, 2) + '\n',
		);
	}
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

/**
 * Commit a new `work/<folder>/<file>` onto the mirror SOURCE repo's `main` (the
 * mirror's origin) WITHOUT touching the bare mirror itself. After this the
 * mirror's `main` is STALE until something fetches it — exactly the condition a
 * fetch-first `scan`/`status` must close. Pairs with {@link registerMirrorWithWork}.
 */
export function pushWorkToMirrorOrigin(
	workspacesDir: string,
	name: string,
	folder: 'backlog' | 'done' | 'needs-attention',
	file: string,
	content: string,
): void {
	const src = mirrorSrc(workspacesDir, name);
	const dir = join(src, 'work', folder);
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, file), content);
	gx(['add', '-A'], src);
	gx(['commit', '-q', '-m', `add ${folder}/${file}`], src);
}

/**
 * Break a registered mirror's `origin` so the next fetch FAILS (it points at a
 * path that does not exist). Used to simulate an unreachable arbiter: a
 * fetch-first `scan`/`status` must WARN and fall back to the mirror's last-known
 * `main`, never error out.
 */
export function breakMirrorOrigin(mirrorPath: string): void {
	gx(
		[
			'remote',
			'set-url',
			'origin',
			'file:///nonexistent/agent-runner-gone.git',
		],
		mirrorPath,
	);
}

export {gx as gitIn};
