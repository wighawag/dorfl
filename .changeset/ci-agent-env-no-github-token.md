---
'dorfl': patch
---

In GitHub Actions, the agents dorfl launches no longer inherit the job's GitHub tokens. Every autonomous launch (the intake decision, builds, the Gate-2 review, surface/triage/apply, tasking and its review, the `run` fleet) goes through the harness adapters, which now remove, whatever the workflow sets: `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `DORFL_GH_TOKEN`, any variable whose value contains a GitHub token (`ghp_`, `ghs_`, `github_pat_`, ..., also inside a URL) or equals one of those, the Actions OIDC and runtime tokens, the runner's `GITHUB_ENV`/`GITHUB_PATH`/`GITHUB_OUTPUT`/`GITHUB_STATE`/`GITHUB_STEP_SUMMARY` files, and git environment config that carries a credential (removed as a whole block, so git never sees a dangling `GIT_CONFIG_COUNT`). PATH, HOME, the provider key and node/pnpm settings pass through. dorfl's own `gh` and git calls keep the token.

This matters because the `intake` workflow runs an agent with a shell over issues any GitHub user can write, and a prompt injection could ask it to print its environment. It is only a first layer: an agent that shares a job with a write token can still reach it other ways (the credential `actions/checkout` persists in `.git/config`, its parent processes' environment, `sudo` on hosted runners). Closing that means running the agent in a job whose token cannot write, which is planned separately.

Nothing changes outside GitHub Actions: on a laptop the agent keeps your environment, so a local MCP server or `gh` call can still use your token. The interactive `start`/`work-on` session is never filtered.
