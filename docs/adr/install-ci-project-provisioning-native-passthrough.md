# install-ci project provisioning uses native-syntax, provider-namespaced, opaque pass-through (no portable step-DSL)

## Context

`install-ci`'s generated CI provisioned only what dorfl + the harness need (Node, the dorfl CLI, the `pi` harness, auth). It provisioned NOTHING of the user's own project toolchain (pnpm@pinned, rust, a project Node, `pnpm install`), so the agent's `dorfl verify` ran against a toolchain nobody installed. Two adjacent gaps: dorfl's own Node step could conflict with the project's, and a repo that pinned dorfl in `devDependencies` got a skewed global dorfl in CI instead.

## Decision

`install-ci` gains a PROJECT-SETUP HOOK that is **provider-namespaced, opaque, and native-syntax pass-through**: the user writes their host CI's native step syntax (for GitHub, real Actions step YAML — `uses:` marketplace actions, `run:` steps) and dorfl splices it VERBATIM into ITS generated composite setup action (`dorfl-setup`), as the FIRST steps, before dorfl-install and AI-auth. The core never parses or normalizes the snippet; each provider adapter owns its own injection point and native shape. dorfl invents NO portable cross-provider step-DSL.

Supporting decisions: (a) NO dorfl-Node-version knob — dorfl declares `node >=18` and runs on any modern Node, so the project's Node is the project's concern (the hook), and the conflicting-toolchain boundary is DOCUMENTED, not detected; (b) the generated CI prefers a project-pinned dorfl (`node_modules/.bin/dorfl`) over the global one, keeping the global install as a zero-config bootstrap. The layering is bootstrap-global → provision-project → prefer-local.

## Considered Options

- **A normalized, portable step schema** (rejected): there is no honest portable translation of e.g. `uses: dtolnay/rust-toolchain` to a GitLab `before_script`. A portable DSL is exactly the thing that gets stuck on the second provider; it also imposes a format to learn + maintain. Provider-namespaced opaque pass-through gives GitHub users full native syntax at near-zero cost (it reuses the existing "interpolate an opaque YAML fragment into the composite action" emitter pattern) and lets a future non-GitHub adapter consume ITS OWN native snippet without a core rewrite.
- **Injecting dorfl's steps into the user's OWN existing workflows** (rejected): breaks dorfl's ownership of the generated files, the idempotent "re-run install-ci to upgrade the shell" contract, and the check-name ↔ workflow-name contract install-ci owns; forces brittle AST-surgery on arbitrary YAML.
- **Presets** (deferred, not rejected): a curated pnpm/node/rust snippet library is later sugar over the same hook; each preset carries a version axis + an opinion + maintenance, so the first cut ships the raw escape hatch only.

## Consequences

- Non-GitHub CI is never blocked by a GitHub-shaped abstraction and dorfl never mistranslates one provider's steps to another; the cost is that there is no automatic portability (a provider migration means writing that provider's snippet).
- The escape hatch deliberately performs only a light structural sanity check, no semantic validation — validating it would re-introduce the mini-format it exists to avoid.

(Full framing: SPEC `work/specs/tasked/install-ci-project-provisioning.md`; tasks `install-ci-project-setup-hook`, `install-ci-document-toolchain-boundary`, `install-ci-prefer-project-local-dorfl`.)
