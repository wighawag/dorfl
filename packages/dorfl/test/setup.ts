/**
 * GLOBAL test setup — runs once per test worker BEFORE any test file imports.
 *
 * It closes THREE ambient-environment leaks that make the suite pass locally but
 * FAIL on a clean CI runner (and vice-versa):
 *
 *  1. GIT IDENTITY / CONFIG ISOLATION. Much of the product code shells out to
 *     `git commit` (surface-persist, triage-persist, needs-attention, the ledger
 *     write seam, …). Many tests call that product code WITHOUT threading an
 *     explicit `env`, so git falls back to whatever identity the PROCESS sees.
 *     On a developer box that is the real `~/.gitconfig` (so it "works"); on a
 *     GitHub Actions VM there is no `user.name`/`user.email`, so the commit dies
 *     with `Author identity unknown` / `empty ident name`. We pin a deterministic
 *     identity on `process.env` AND point git at /dev/null for global+system
 *     config, so EVERY git invocation in the suite — test-helper or product —
 *     sees the SAME isolated identity regardless of the host. (This mirrors what
 *     the `gitEnv()` test helper does per-call; doing it here makes it
 *     unconditional so no individual call site has to remember to thread it.)
 *
 *  2. `DORFL_*` CONFIG LEAKAGE. `loadConfig` reads `DORFL_*` env
 *     vars and lets them OVERRIDE per-call config. CI exports gate vars
 *     (`DORFL_AUTO_BUILD=true`, `DORFL_AUTO_TASK=true`, …) for the
 *     `advance`/`run` steps; if those leak into the unit-test process they
 *     silently override the `autoBuild:false` / `autoTask:false` setups that
 *     gating tests rely on, so gated-off pools come back populated and counts are
 *     wrong. We delete every `DORFL_*` var up-front so the tests see ONLY
 *     the config they pass explicitly — identical on a dev box and on CI.
 *
 *  3. CI-MODE LEAKAGE. dorfl removes GitHub tokens from agent launches when
 *     `GITHUB_ACTIONS=true`; the suite starts outside that mode so it behaves
 *     the same on a dev box and on a runner (see the block below).
 *
 *  4. REAL-HOME LEAKAGE. `DEFAULT_CONFIG.workspacesDir` (`~/.dorfl`) and
 *     `arbitersDir` are computed from `homedir()` ONCE, when `config.ts` is first
 *     imported, so a test that sets `HOME` in `beforeEach` cannot redirect them.
 *     Any test that forgot an explicit workspaces dir materialised hub mirrors in
 *     the developer's REAL `~/.dorfl/repos/` (hundreds of dead
 *     `tmp/pre-backlog-step-a-*` mirrors, each a `dorfl status` warning). We point
 *     `HOME` + `XDG_CONFIG_HOME` at a per-file scratch dir HERE, before any test
 *     file imports product code, so every home-derived default is scratch. Tests
 *     that set their own `HOME` still do; they restore to this scratch home.
 *     Guarded by `suite-home-isolation.test.ts`.
 *
 * All four are pure ENVIRONMENT isolation: they do not change product behaviour, only
 * stop the host's ambient state from bleeding into the suite.
 */

import {afterAll} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// 1. Deterministic, host-independent git identity + config isolation.
process.env.GIT_AUTHOR_NAME = 'Test Runner';
process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
process.env.GIT_COMMITTER_NAME = 'Test Runner';
process.env.GIT_COMMITTER_EMAIL = 'test@example.com';
process.env.GIT_TERMINAL_PROMPT = '0';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

// 2. Strip any DORFL_* config-override vars the host/CI may have exported.
for (const key of Object.keys(process.env)) {
	if (key.startsWith('DORFL_')) {
		delete process.env[key];
	}
}

// 3. dorfl removes GitHub tokens from agent launches in GitHub Actions
//    (`GITHUB_ACTIONS=true`, see `agent-env.ts`). The suite must behave the same
//    on a dev box and on a runner, so it starts outside that mode; the tests
//    that cover it set it explicitly for their own spawns.
delete process.env.GITHUB_ACTIONS;

// 4. A scratch HOME for this test file, set before any product module loads.
const scratchHome = mkdtempSync(join(tmpdir(), 'dorfl-test-home-'));
process.env.HOME = scratchHome;
process.env.XDG_CONFIG_HOME = join(scratchHome, '.config');
afterAll(() => {
	rmSync(scratchHome, {recursive: true, force: true});
});
