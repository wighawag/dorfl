import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, dirname} from 'node:path';
import {harnessReviewGate, ReviewParseError} from '../src/review-gate.js';
import {createHarness} from '../src/pi-harness.js';

/**
 * Gate-2 wiring regression guard for observation
 * `complete-and-run-review-gate-not-harness-wired-empty-agentcmd`.
 *
 * The `complete` and `run` commands used to construct their Gate-2 review gate as
 * an ARG-LESS `harnessReviewGate()`, which defaults to a `NullHarness` + empty
 * `agentCmd`. So `complete --review` / a `run`-tick review threw
 * "empty agentCmd — nothing would run" WHENEVER `--review` was on, even under
 * `harness: pi` (the pi adapter does not consume `agentCmd`; only the null/shell
 * adapter does). The `do` path proved the gate works — it resolves the harness via
 * `createHarness({harness, piBin})` and threads `{harness, agentCmd}` — so this was
 * a wiring asymmetry, not a config error.
 *
 * This guard pins both halves of the contract the way
 * `cli-apply-decider-wiring.test.ts` pins the apply decider:
 *
 *  1. the BEHAVIOURAL fact that the UNWIRED default gate (NullHarness + empty
 *     agentCmd) THROWS the empty-agentCmd config error on launch — so a missing
 *     wiring is a hard failure, not a silent no-op (mirrors `harness.test.ts:80`);
 *  2. the BEHAVIOURAL fact that a gate wired the way `complete`/`run` now build it
 *     — a pi-backed harness (`createHarness({harness:'pi'})`) + `agentCmd:''` —
 *     does NOT hit the empty-agentCmd guard (it fails downstream on the empty
 *     verdict instead), i.e. the pi gate actually runs;
 *  3. a SOURCE-TEXT assertion that BOTH the `complete` and `run` sites wire
 *     `harnessReviewGate({harness, agentCmd})` (never the arg-less default), so a
 *     future edit that drops the wiring is caught.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cliSrc = readFileSync(join(here, '..', 'src', 'cli.ts'), 'utf8');

describe('complete/run wire a harness-backed Gate-2 review gate (not NullHarness + empty agentCmd)', () => {
	it('the UNWIRED default review gate THROWS the empty-agentCmd config error on launch', async () => {
		// This is WHY the sites must thread the harness: the fallback is not a benign
		// no-op, it is the same hard config error the NullHarness launch backstop
		// raises for an empty command (harness.test.ts:80). `complete --review` / a
		// `run`-tick review used to build EXACTLY this gate.
		const gate = harnessReviewGate();
		await expect(
			gate({slug: 'feat', cwd: process.cwd(), round: 1}),
		).rejects.toThrow(/agentCmd/);
	});

	it('a `harness: pi` gate (with empty agentCmd) does NOT hit the empty-agentCmd guard — the pi gate runs', async () => {
		// Build the gate EXACTLY as complete/run now do: resolve the harness via
		// createHarness({harness:'pi', piBin}) and thread {harness, agentCmd}. `piBin`
		// is stubbed to `true` (a real binary that exits 0 with no output) so the pi
		// adapter spawns successfully; agentCmd is '' (normal for the pi harness). The
		// pi adapter never consults agentCmd, so this must NOT throw /agentCmd/ — it
		// fails DOWNSTREAM on the empty verdict (ReviewParseError), proving the pi gate
		// actually launched instead of tripping the null-adapter guard.
		const harness = createHarness({harness: 'pi', piBin: 'true'});
		const gate = harnessReviewGate({harness, agentCmd: ''});
		const err = await gate({
			slug: 'feat',
			cwd: process.cwd(),
			round: 1,
		}).then(
			() => undefined,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(ReviewParseError);
		expect((err as Error).message).not.toMatch(/agentCmd/);
	});

	it('both the complete and run sites wire harnessReviewGate({harness, agentCmd}) (never the arg-less default)', () => {
		// SOURCE-TEXT guard: an arg-less `harnessReviewGate()` at either site would
		// re-introduce the NullHarness + empty-agentCmd bug. Assert every review-gate
		// construction threads the harness, and that NO arg-less call survives.
		const wiredSites =
			cliSrc.match(/harnessReviewGate\(\{\s*[\s\S]*?harness/g) ?? [];
		// do (+ its --remote/isolated variants) + complete + run all thread the harness.
		expect(wiredSites.length).toBeGreaterThanOrEqual(4);
		// The arg-less default (the bug shape) appears nowhere.
		expect(cliSrc).not.toMatch(/harnessReviewGate\(\)/);
	});
});
