/**
 * **The failure-CAUSE classifier** (task `failure-cause-classification-model-vs-
 * git-vs-agent`).
 *
 * When a claimed item is marked stuck on its per-item lock (post lock-cutover —
 * `state: stuck`, no `work/needs-attention/` folder write), the runner records WHY.
 * Historically several DIFFERENT causes collapsed into one undifferentiated label
 * ("agent failed"), even though the CAUSE drives the RECOVERY:
 *
 *   - **transient-infra** → retry the SAME work (the work is fine: a model
 *     endpoint outage the harness surfaced AFTER its own retries, or a git/
 *     provider outage).
 *   - **config-error** → fix the WIRING, not the task (a thrown CORE wiring/
 *     config error, e.g. `review` on with no `reviewGate` configured).
 *   - **agent-failed** (the conservative generic) → a human/agent must FIX
 *     something the agent did (ran but produced bad/empty output), OR the cause is
 *     simply UNKNOWN — the safe default that never forces a wrong specific label.
 *
 * This module classifies ONLY the axis that was previously lumped under
 * "agent-failed". The OTHER existing terminal causes already have precise names
 * and are NOT re-classified here — a red acceptance gate stays `gate-failed`, a
 * rebase abort stays `rebase-conflict`, a deliberate STOP stays `agent-stopped`,
 * a Gate-2 block stays `review-blocked`. This is the CAUSE axis ON TOP of those
 * (see CONTEXT.md's *failure cause* glossary entry — the single source of truth).
 *
 * The classification is BEST-EFFORT + CONSERVATIVE: an unrecognised cause stays
 * the generic `agent-failed`. The new precision is ADDED only where the cause is
 * knowable from the surfaced error/detail; it never forces a wrong label.
 *
 * **`do` and `run` classify the SAME error the SAME way** by both routing their
 * thrown-core-error / failed-agent detail through THIS one function — closing the
 * cross-path divergence recorded in
 * `work/notes/observations/run-thrown-core-error-labeled-agent-failed.md` (the SAME
 * thrown core error used to read as `usage-error` in `do` but `agent-failed` in
 * `run`).
 *
 * SCOPE FENCE: model-endpoint RETRIES are the HARNESS's job (pi retries its own
 * API ~3–4×). This module does NOT add retries — it only CLASSIFIES what the
 * harness SURFACES once its retries are exhausted (so a post-retry model outage
 * reads as `transient-infra`, distinct from the agent producing bad output).
 */

/**
 * The CAUSE of a stuck item, the axis ON TOP of the existing terminal outcomes.
 * Only the values this module decides between are listed — the genuinely-NEW
 * `transient-infra` / `config-error` plus the conservative generic `agent-failed`
 * (the existing name, reused as the safe default). The other terminal causes
 * (`gate-failed`, `rebase-conflict`, `agent-stopped`, `review-blocked`) are NOT
 * produced here; they keep their own precise outcome names at their own sites.
 */
export type FailureCause =
	| 'transient-infra' // a harness-surfaced model/connection outage (post-retry), or a git/provider outage — RETRY the same work
	| 'needs-reauth' // a credential expired / was revoked (e.g. OAuth refresh token) — RETRY CANNOT help; a human must RE-AUTH
	| 'config-error' // a thrown CORE wiring/config error (e.g. review on, no reviewGate) — fix the WIRING
	| 'agent-failed'; // the conservative generic: the agent ran but produced bad/empty output, OR the cause is UNKNOWN

/**
 * The signature of a thrown CORE wiring/config error this module recognises. The
 * core throws a plain `Error` for `review` on with no `reviewGate` wired (the
 * canonical config-error; see `integration-core.ts`), whose message contains
 * "wiring bug". We match on that stable phrase rather than the error CLASS so the
 * classification survives the message crossing the plain-`Error` boundary the
 * catch sites hand us (they only have `err.message`).
 */
const CONFIG_ERROR_SIGNATURES = [
	/wiring bug/i,
	/no review gate is configured/i,
];

/**
 * Substrings that mark a CREDENTIAL-EXPIRY failure surfaced by the harness: an
 * OAuth refresh token has expired or been revoked, or a 401 came back tagged
 * `authentication_required`. Retry cannot help these — only a human RE-AUTH can.
 * Kept SEPARATE from `TRANSIENT_INFRA_SIGNATURES` (see ADR
 * `transient-infra-and-needs-reauth-routing`) so downstream routing can branch
 * cleanly on the cause: retry-with-backoff for infra, straight to a needs-reauth
 * surface for credentials. Conservative: unrelated 401s that don't mention auth /
 * token stay `agent-failed`.
 */
const NEEDS_REAUTH_SIGNATURES = [
	/authentication_required/i,
	/OAuth (?:refresh )?token (?:expired|revoked|invalid)/i,
	/refresh token (?:expired|revoked|invalid)/i,
	/\b401\b[^\n]{0,80}(?:auth|token|credential|unauthori[sz]ed)/i,
	/(?:auth|token|credential)[^\n]{0,40}\b401\b/i,
];

/**
 * Substrings that mark a TRANSIENT-INFRA failure: a model endpoint / connection
 * outage the harness surfaced AFTER exhausting its own retries, or a git/provider
 * outage. Best-effort lexical signals (the harness/git only hand us a message
 * string) — deliberately conservative: anything not matched stays `agent-failed`.
 */
const TRANSIENT_INFRA_SIGNATURES = [
	// A Gate-2 review verdict the runner could not PARSE (malformed JSON from the
	// review agent, common on large diffs + weaker models). This is `transient-infra`,
	// NOT `agent-failed`/`config-error`: the WORK is fine and the wiring is fine; the
	// STOCHASTIC gate output misbehaved, so re-running the SAME work is the natural
	// recovery (and the parser's repair pass + the tightened contract make a re-run far
	// more likely to parse). Matches both `parseReviewVerdict` throw phrasings ("review
	// verdict was not valid JSON" and "produced no parseable {verdict, findings}") and
	// the core's "verdict could not be parsed" wrapper.
	/review verdict was not valid JSON/i,
	/verdict could not be parsed/i,
	/no parseable \{verdict/i,
	/\bECONN(?:REFUSED|RESET|ABORTED)\b/i,
	/\bETIMEDOUT\b/i,
	/\bENOTFOUND\b/i,
	/\bEAI_AGAIN\b/i,
	/connection (?:error|refused|reset|timed out|failed)/i,
	/network (?:error|is unreachable|timeout)/i,
	/\b(?:could not|unable to) (?:connect|reach)\b/i,
	/\btimed? ?out\b/i,
	/\b(?:overloaded|service unavailable|temporarily unavailable)\b/i,
	/\b(?:429|500|502|503|504)\b/,
	/model (?:endpoint )?(?:offline|unavailable|overloaded)/i,
	/(?:after|exhausted) .{0,40}retr(?:y|ies)/i,
	/rate.?limit/i,
];

/**
 * Classify a failure CAUSE from the surfaced error/detail text, best-effort +
 * conservative (an unrecognised cause stays `agent-failed`).
 *
 * Order matters: a thrown CORE config/wiring error is checked FIRST (it is the
 * most specific + the cross-path divergence this task closes), then the
 * transient-infra signals, else the generic default.
 *
 * Used by BOTH `do` and `run` at their failure-routing sites so the SAME error
 * yields the SAME cause regardless of path.
 */
export function classifyFailureCause(detail: string | undefined): FailureCause {
	const text = (detail ?? '').trim();
	if (text === '') {
		return 'agent-failed';
	}
	if (CONFIG_ERROR_SIGNATURES.some((re) => re.test(text))) {
		return 'config-error';
	}
	// Credential-expiry is checked BEFORE `transient-infra` because a 401 body may
	// also mention words like "unavailable"/network, and no amount of retry helps
	// — a human must re-auth. Kept as its own cause per ADR
	// `transient-infra-and-needs-reauth-routing`.
	if (NEEDS_REAUTH_SIGNATURES.some((re) => re.test(text))) {
		return 'needs-reauth';
	}
	if (TRANSIENT_INFRA_SIGNATURES.some((re) => re.test(text))) {
		return 'transient-infra';
	}
	return 'agent-failed';
}

/**
 * A short, human-readable label for a cause, used to PREFIX the recorded
 * needs-attention reason so an operator (or an autonomous triage loop) reads the
 * cause WITHOUT a second naming scheme. The generic `agent-failed` gets the
 * historical "agent failed:" prefix so existing reason prose / tests are
 * unchanged; only the NEW causes carry a distinct, legible prefix.
 */
export function failureCauseLabel(cause: FailureCause): string {
	switch (cause) {
		case 'transient-infra':
			return 'transient infra';
		case 'needs-reauth':
			return 'needs re-auth (credential expired)';
		case 'config-error':
			return 'config error';
		case 'agent-failed':
			return 'agent failed';
	}
}
