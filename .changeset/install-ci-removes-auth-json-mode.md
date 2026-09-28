---
'dorfl': minor
---

`dorfl install-ci` no longer offers the `auth-json` provider mode. It never worked (no generated workflow passed `PI_AUTH_JSON` or `GH_PAT` to the setup action), and making it work would have put a write-capable `GH_PAT` into the agent job to rotate the OAuth token, which the CI design forbids. `models-json` is now the only mode: the wizard no longer asks for an auth mode, and the generated setup action and artifacts no longer carry the auth.json step, the `refresh-oauth-token.mjs` script or any `GH_PAT`. A `--config` file with `"authMode": "auth-json"` is refused with an error that points at the replacement: `"authMode": "models-json"` with a provider `baseUrl` set to a proxy that rotates credentials outside GitHub. Existing `models-json` configs (with or without the `authMode` key) load and export unchanged. The `REFRESH_OAUTH_SCRIPT` export is removed; `AUTH_JSON_REMOVED_MESSAGE` is exported instead.
