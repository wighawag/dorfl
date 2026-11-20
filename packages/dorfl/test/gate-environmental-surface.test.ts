import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {parseSidecar} from '../src/sidecar.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Regression (dorfl 0.16.0, rocketh-playground): a gate that failed only because
 * another project held the ports the Playwright suite binds was surfaced with
 * the generic "how should we proceed?" question, as if the work were wrong. It
 * is now surfaced as ENVIRONMENTAL, with a retry question.
 */

const ARBITER = 'arbiter';
const PLAYWRIGHT =
	'Error: http://localhost:4273 is already used, make sure that nothing is ' +
	'running on the port/url or set reuseExistingServer:true in config.webServer.';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-gate-env-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

describe('an environmental gate failure is surfaced as environmental', () => {
	it('names the machine cause, asks to retry, and keeps em dashes out of main', async () => {
		const slug = 'alpha';
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		expect(
			(await performClaim({slug, cwd: repo, arbiter: ARBITER, env: gitEnv()}))
				.exitCode,
		).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'work.txt'), 'the work\n');

		const result = await performComplete({
			cwd: repo,
			slug,
			arbiter: ARBITER,
			integration: 'merge',
			verify: ['true', `echo '${PLAYWRIGHT}' >&2; exit 1`],
			freshWorktreeGate: true,
			surfaceArbiter: ARBITER,
			// No waits in the test (the retry itself is covered in verify.test.ts).
			env: {...gitEnv(), DORFL_GATE_ENV_RETRY_DELAYS_MS: ''},
		});
		expect(result.outcome).toBe('gate-failed');
		expect(result.message).toMatch(/ENVIRONMENTAL, not the work/);

		gitIn(['fetch', '-q', ARBITER], repo);
		const sidecar = run(
			'git',
			['show', `${ARBITER}/main:work/questions/task-${slug}.md`],
			repo,
			{env: gitEnv()},
		);
		expect(sidecar.status).toBe(0);
		const [entry] = parseSidecar(sidecar.stdout).entries;
		expect(entry.question).toMatch(/environmental reason/);
		expect(entry.question).toMatch(/4273/);
		expect(entry.question).not.toMatch(/how should we proceed/);
		expect(entry.default).toBe('retry');
		expect(sidecar.stdout).not.toContain('\u2014');
		const subject = gitIn(
			['log', '-1', '--format=%B', `${ARBITER}/main`],
			repo,
		);
		expect(subject).not.toContain('\u2014');
	}, 60_000);
});
