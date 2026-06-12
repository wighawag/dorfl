import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {runOnce, type AgentRunner} from '../src/run.js';
import {performClaim} from '../src/claim-cas.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import * as ledgerWriteModule from '../src/ledger-write.js';
import * as repoConfigModule from '../src/repo-config.js';
import type {ScanReport} from '../src/scan.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * REGRESSION PINS for two thin-coverage `run`/claim internal-error paths (slice
 * `run-internal-error-tests`). These paths were only exercised INDIRECTLY by the
 * higher-level concurrency tests, so a refactor could silently break them. The
 * three pins here make the behaviour explicit + a regression loud:
 *
 *   (1) `performClaim`'s RETRY branch — the `git checkout --detach <arbiter>/main`
 *       BEFORE `branch -D`+`checkout -b` that makes the throwaway claim branch
 *       idempotently deletable+recreatable across attempts (drive a forced CAS
 *       rejection; the SECOND attempt must succeed — it FAILS if the detach goes).
 *   (2) `runOneItem`'s thrown-core-error → `config-error` (NOT `agent-failed`),
 *       work preserved, the tick CONTINUES — the `run`-side mirror of the `do`
 *       twin (`test/do.test.ts`).
 *   (3) `runOnce`'s settled-slot `.map` fallback → `claim-error` carrying the
 *       captured error message in `detail` (a worker that throws BEFORE the
 *       per-item try/catch is reached — `runOneItem` is documented never to throw,
 *       so this is the defensive last-resort mapping).
 *
 * Tests-only: no production behaviour changes. House harness — throwaway repos +
 * a local `--bare` arbiter; temp `workspacesDir`; `isolatePiAgentDir` so the real
 * `~/.agent-runner/` + `~/.pi/agent/sessions/` are untouched.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-run-internal-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
	vi.restoreAllMocks();
});

const PASS = 'exit 0';

/** An agent that edits a file (non-empty diff) and succeeds — reaches integration. */
const editingAgent: AgentRunner = ({cwd, slug}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
	return {ok: true};
};

function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
	return scanRepoPaths([join(scratch.root, 'project')], config);
}

function configFor(overrides = {}) {
	return mergeConfig({
		defaultArbiter: 'arbiter',
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		verify: PASS,
		allowAgents: true,
		...overrides,
	});
}

// ── (1) performClaim's RETRY branch: the idempotent claim-branch reset ──────────

describe('performClaim — RETRY branch pins the idempotent claim-branch reset', () => {
	it('a CAS rejection on the FIRST attempt is followed by a SUCCESSFUL second attempt (detach-before-delete reset)', async () => {
		// Force EXACTLY ONE CAS rejection by stubbing the write seam to reject the
		// first publish, then delegate to the REAL strategy for the retry — the
		// slice's "stub the push to reject once" option. This drives `performClaim`
		// straight into its `while(true)` retry branch deterministically (no race
		// timing). On the SECOND attempt HEAD is still on `claim/<slug>` from the
		// rejected first attempt, so the `git branch -D claim/<slug>` would REFUSE
		// ("cannot delete the current branch") and the re-`checkout -b` would fail
		// ("already exists") WITHOUT the `git checkout --detach <arbiter>/main`
		// preamble. The second attempt SUCCEEDING is the proof the detach reset
		// fired — REMOVE the detach in claim-cas.ts and this test FAILS.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const real = ledgerWriteModule.currentLedgerWrite.applyTransition.bind(
			ledgerWriteModule.currentLedgerWrite,
		);
		const spy = vi
			.spyOn(ledgerWriteModule.ledgerWrite, 'applyTransition')
			.mockImplementationOnce(async () => ({
				kind: 'rejected',
				message: 'push rejected / lease failed (forced once)',
			}))
			.mockImplementation(real);

		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			// >=1 retry so the rejection is retried, not given up as contended.
			retries: 3,
			env: gitEnv(),
		});

		// Two attempts ran: the forced rejection THEN the real (successful) publish.
		expect(spy).toHaveBeenCalledTimes(2);
		// The second attempt CLAIMED — the branch reset across attempts was clean
		// (no "branch already exists" / "cannot delete current branch" plumbing
		// error surfaced as a usage-error).
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
		expect(result.message).not.toMatch(/already exists|delete.*branch/i);
		// The claim genuinely landed on the arbiter.
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(false);
		// The throwaway claim branch was cleaned up (HEAD restored, no leftover).
		expect(gitIn(['branch', '--list', 'claim/alpha'], repo).trim()).toBe('');
	});
});

// ── (2) runOneItem's thrown-core-error → config-error (mirrors the do twin) ─────

describe('runOnce — a thrown CORE wiring/config error is config-error, NOT agent-failed', () => {
	it('review on with NO reviewGate wired → config-error, work preserved/surfaced, tick CONTINUES', async () => {
		// `review` on but NO `reviewGate` injected ⇒ the shared `performIntegration`
		// core THROWS a plain Error whose message contains "wiring bug"; `runOneItem`'s
		// catch routes it through `saveAgentFailure` → `classifyFailureCause`, which
		// matches `/wiring bug/i` → `config-error` (NOT the generic `agent-failed`).
		// This is the `run`-side mirror of `test/do.test.ts`'s twin pin. TWO items so
		// the pin also proves a thrown core error does NOT crash the whole tick — the
		// OTHER item still completes.
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat', 'sibling']);
		const config = configFor({review: true}); // review on, but no reviewGate ⇒ throws
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});

		// Every item that ran is config-error (both hit the same misconfig) — and
		// NEVER the generic agent-failed (the cross-path label divergence the source
		// observation flagged is closed; `do` records the SAME label).
		expect(result.items.length).toBeGreaterThanOrEqual(1);
		for (const item of result.items) {
			expect(item.status).toBe('config-error');
			expect(item.status).not.toBe('agent-failed');
			// The classified cause + the underlying wiring-bug message are surfaced in
			// detail (mirrors the do twin's `/wiring bug|review gate/i` message pin).
			expect(item.detail).toMatch(/wiring bug|review gate/i);
		}
		// The tick did NOT crash: each selected item produced a result.
		expect(result.items.length).toBe(2);

		// Work preserved + SURFACED on the arbiter (the work-preserving needs-attention
		// seam ran), never reaching done.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(false);
	});
});

// ── (3) runOnce's settled-slot fallback → claim-error with captured detail ──────

describe('runOnce — settled-slot fallback maps an uncaught worker throw to claim-error', () => {
	it('a worker that throws BEFORE the per-item guards → claim-error carrying the captured message in detail', async () => {
		// `runOneItem` is documented never to throw (it maps every failure to an
		// ItemResult); `runOnce`'s `settled.map` defensive fallback maps a captured
		// `{error}` slot to `status: 'claim-error'` with the message in `detail`. To
		// force a GENUINE uncaught worker throw with NO production change, commit a
		// MALFORMED `.agent-runner.json` at the repo root: `runOneItem`'s FIRST
		// statement is `resolveRepoConfig(...)` (BEFORE any try/catch and before the
		// claim), which `JSON.parse`s the per-repo file and THROWS "Invalid JSON in
		// <path>: ..." on bad bytes. That throw escapes the worker, is captured as a
		// settled `{error}`, and the fallback maps it to claim-error.
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor();
		// Build the report with the REAL `resolveRepoConfig` (clean repo) BEFORE
		// arming the throw — `scanRepoPaths` itself calls `resolveRepoConfig`, so the
		// scan must run against a valid config. The injected report then short-
		// circuits `runOnce`'s own scan, so the ONLY remaining `resolveRepoConfig`
		// call is `runOneItem`'s FIRST statement (the worker).
		const report: ScanReport = scanProject(config);

		// Now make the WORKER's `resolveRepoConfig` throw — the realistic cause is a
		// malformed committed `.agent-runner.json` (`JSON.parse` → "Invalid JSON in
		// <path>"). Stubbing it here forces that uncaught throw INSIDE `runOneItem`
		// (BEFORE its per-item try/catch + before the claim), so it escapes the worker
		// exactly as the real misconfig would, exercising `runOnce`'s settled-slot
		// `.map` fallback. Test-only seam (no production change).
		const thrown = new Error(
			`Invalid JSON in ${join(repo, '.agent-runner.json')}: Expected property name`,
		);
		vi.spyOn(repoConfigModule, 'resolveRepoConfig').mockImplementation(() => {
			throw thrown;
		});

		const result = await runOnce({
			config,
			report,
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});

		expect(result.items).toHaveLength(1);
		const item = result.items[0];
		expect(item.status).toBe('claim-error');
		// The captured throw's message is surfaced in `detail` (the fallback reads
		// `(slot.error as Error)?.message`).
		expect(item.detail).toBeDefined();
		expect(item.detail).toMatch(/Invalid JSON/i);
		// It is counted as failed (the FAILURE-CAUSE family + claim-error all count).
		expect(result.failed).toBe(1);
		expect(result.claimedAndDone).toBe(0);
		// Nothing reached the arbiter's done/in-progress (the throw was pre-claim).
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
	});
});
