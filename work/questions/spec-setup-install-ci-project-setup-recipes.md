<!-- dorfl-sidecar: item=spec:setup-install-ci-project-setup-recipes type=spec slug=setup-install-ci-project-setup-recipes allAnswered=false -->

Item: [`spec:setup-install-ci-project-setup-recipes`](../specs/ready/setup-install-ci-project-setup-recipes.md)

## Q1

**Which recipes ship in the first cut?**

> Spec Open Q1. Proposed: Node+pnpm (rocketh case: pnpm/action-setup + setup-node cache + pnpm install --frozen-lockfile + local-main fixup) and Node+npm (npm ci), plus one non-JS to prove the shape generalises — Go (actions/setup-go) and/or Rust (dtolnay/rust-toolchain). ADR says 2-3 first; each preset carries version axis + opinion + maintenance.

_Suggested default: Node+pnpm and Node+npm, plus Go as the non-JS proof; Rust follows once shape is proven._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Where does a recipe read its VERSION from (to pin reproducibly, not hardcode a stale version)?**

> Spec Open Q2. Proposed per-stack sources: Node — packageManager / .tool-versions / engines.node; Go — go.mod; Rust — rust-toolchain.toml; recipe default only when absent. Confirm per-recipe precedence + fallback-default policy.

_Suggested default: Read from repo where an unambiguous source exists; fall back to a recipe-carried default (bumped as documentation-grade maintenance) only when absent._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**How does the human SELECT a recipe — a menu at install-ci time, a setup A3b-linked offer, or both?**

> Spec Open Q3. setup A3b already detects the stack from a lockfile to propose prepare; extending that detection could also OFFER the CI recipe (recorded as projectSetup.<provider> for later install-ci), AND expose a picker in the install-ci wizard.

_Suggested default: Both — setup A3b offers on detection (writes projectSetup.<provider>), install-ci wizard exposes a picker for the non-setup path._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Where do the recipe snippets LIVE + how are they kept fresh?**

> Spec Open Q4. Proposed: provider-namespaced recipe asset set inside the package (each recipe = provider native snippet + small version-source descriptor), owned like the protocol docs; stale recipes are a documentation-grade maintenance item, not a correctness gate.

_Suggested default: Data files (per-provider directory of native snippets + a small version-source descriptor) inside the dorfl package; freshness is documentation-grade._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**Detection→offer boundary (the A3 line): must the human always CONFIRM before a recipe is written, or may an explicit --recipe <name> flag write it unprompted?**

> Spec Open Q5. Proposed: OFFER-and-confirm by default (never silent inject, per A3 + the ADR); an explicit flag is opt-in that IS the confirmation.

_Suggested default: Offer-and-confirm by default; an explicit --recipe flag counts as the confirmation and writes unprompted._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):
