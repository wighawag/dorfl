import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {runOnce, type Dorfl} from '../src/run.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import * as repoConfigModule from '../src/repo-config.js';
import type {ScanReport} from '../src/scan.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	type Scratch,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
} from './helpers/gitRepo.js';

/**
 * REGRESSION PINS for two thin-coverage `run`/claim internal-error paths (task
 * `run-internal-error-tests`). These paths were only exercised INDIRECTLY by the
 * higher-level concurrency tests, so a refactor could silently break them. The
 * pins here make the behaviour explicit + a regression loud:
 *
 *   (2) `runOneItem`'s thrown-core-error → `config-error` (NOT `agent-failed`),
 *       work preserved, the tick CONTINUES — the `run`-side mirror of the `do`
 *       twin (`test/do.test.ts`).
 *   (3) `runOnce`'s settled-slot `.map` fallback → `claim-error` carrying the
 *       captured error message in `detail` (a worker that throws BEFORE the
 *       per-item try/catch is reached — `runOneItem` is documented never to throw,
 *       so this is the defensive last-resort mapping).
 *
 * (Pin (1) — `performClaim`'s claim-branch RETRY reset — was RETIRED when the
 * lock-substrate cut-over removed claim's body move / `main` push / retry loop
 * entirely: claim acquires a per-item lock and writes nothing to `main`, so there
 * is no throwaway claim branch or CAS-retry to pin. See task
 * `cutover-claim-body-stays-and-complete-sources-from-backlog`.)
 *
 * Tests-only: no production behaviour changes. House harness — throwaway repos +
 * a local `--bare` arbiter; temp `workspacesDir`; `isolatePiAgentDir` so the real
 * `~/.dorfl/` + `~/.pi/agent/sessions/` are untouched.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-run-internal-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
	vi.restoreAllMocks();
});

const PASS = 'exit 0';

/** An agent that edits a file (non-empty diff) and succeeds — reaches integration. */
const editingAgent: Dorfl = ({cwd, slug}) => {
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
		autoBuild: true,
		...overrides,
	});
}

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
			dorfl: editingAgent,
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
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'feat')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'feat')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'feat')).toBe(true);
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
		// MALFORMED `.dorfl.json` at the repo root: `runOneItem`'s FIRST
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
		// malformed committed `.dorfl.json` (`JSON.parse` → "Invalid JSON in
		// <path>"). Stubbing it here forces that uncaught throw INSIDE `runOneItem`
		// (BEFORE its per-item try/catch + before the claim), so it escapes the worker
		// exactly as the real misconfig would, exercising `runOnce`'s settled-slot
		// `.map` fallback. Test-only seam (no production change).
		const thrown = new Error(
			`Invalid JSON in ${join(repo, '.dorfl.json')}: Expected property name`,
		);
		vi.spyOn(repoConfigModule, 'resolveRepoConfig').mockImplementation(() => {
			throw thrown;
		});

		const result = await runOnce({
			config,
			report,
			workspace: join(scratch.root, 'ws'),
			dorfl: editingAgent,
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
